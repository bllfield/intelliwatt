# Manual Entry to 15-Minute Intervals Normalization
## Implementation Guide for New Projects

This guide explains how to port the manual-to-intervals normalization pipeline from the Intellipath Tools Website project into your new IntelliWatt or other projects.

---

## Overview

**What it does:** Converts manual monthly or annual energy consumption entries into realistic 15-minute interval data suitable for simulations, storage, and analytics.

**Where it exists:** 
- **Server-side logic:** `backend/simulation.py` in Intellipath project
- **Client-side distribution:** `frontend/Energy_Flow_Tool.html` (JavaScript)
- **Database models:** `backend/database/database.py` (ManualMonthly, ManualAnnual, ConsumptionData)

**Output:** Array of interval records with timestamp, consumption (kWh), interval_minutes=15, unit='kWh'

---

## Step 1: Database Models

Copy or adapt these SQLAlchemy models to your project:

### Model 1: ManualMonthly (stores user-entered monthly totals)
```python
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime

class ManualMonthly(Base):
    __tablename__ = "manual_monthly_input"
    
    id = Column(Integer, primary_key=True)
    home_id = Column(String, ForeignKey("homes.home_id"))
    month = Column(String)  # "1" to "12"
    total = Column(Float)   # kWh
    unusual_travel_dates = Column(String, nullable=True)  # JSON array
    day_of_bill = Column(Integer, nullable=True)  # Billing day (1-31)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    home = relationship("Home", back_populates="manual_monthly")
```

### Model 2: ManualAnnual (stores user-entered annual total)
```python
class ManualAnnual(Base):
    __tablename__ = "manual_annual"
    
    id = Column(Integer, primary_key=True)
    home_id = Column(String, ForeignKey("homes.home_id"))
    annual_usage = Column(Float)  # kWh
    start_date = Column(String, nullable=True)  # "YYYY-MM-DD"
    end_date = Column(String, nullable=True)  # "YYYY-MM-DD"
    unusual_travel_dates = Column(String, nullable=True)  # JSON array
    created_at = Column(DateTime, default=datetime.utcnow)
    
    home = relationship("Home", back_populates="manual_annual")
```

### Model 3: ConsumptionData (stores the normalized 15-min intervals)
```python
class ConsumptionData(Base):
    __tablename__ = "consumption_data"
    
    id = Column(Integer, primary_key=True)
    home_id = Column(String, ForeignKey("homes.home_id"))
    uploaded_file_id = Column(Integer, ForeignKey("uploaded_files.id"), nullable=True)
    timestamp = Column(DateTime)  # interval start, tz-aware
    consumption = Column(Float)   # kWh for this 15-min interval
    interval_minutes = Column(Integer, default=15)
    unit = Column(String)  # "kWh"
    created_at = Column(DateTime, default=datetime.utcnow)
    
    home = relationship("Home", back_populates="consumption_data")
```

### Model 4: HomeDetails (for home characteristics used in normalization)
```python
class HomeDetails(Base):
    __tablename__ = "home_details"
    
    home_id = Column(String, ForeignKey("homes.home_id"), primary_key=True)
    home_age = Column(Integer, nullable=True)
    square_feet = Column(Integer, nullable=True)
    stories = Column(Integer, nullable=True)
    insulation_type = Column(String, nullable=True)  # "poor", "standard", "good", etc.
    window_type = Column(String, nullable=True)      # "single", "double", "triple"
    foundation = Column(String, nullable=True)
    led_lights = Column(Boolean, nullable=True)
    smart_thermostat = Column(Boolean, nullable=True)
    summer_temp = Column(Integer, nullable=True)     # °F
    winter_temp = Column(Integer, nullable=True)     # °F
    occupants_work = Column(Integer, nullable=True)
    occupants_school = Column(Integer, nullable=True)
    occupants_home = Column(Integer, nullable=True)
    
    home = relationship("Home", back_populates="details")
```

---

## Step 2: Core Normalization Utility

Create file: `backend/utils/normalize_manual_to_intervals.py`

This is the **core logic** you need. Copy this entire file:

```python
"""
Normalize manual monthly/annual energy entries into 15-minute intervals.
Based on home characteristics and weather patterns.
"""

from datetime import datetime, timedelta
import calendar
from typing import List, Dict, Optional, Tuple
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)

# ============================================================================
# CORE NORMALIZATION FUNCTIONS
# ============================================================================

def monthly_to_intervals(
    monthly_rows: List[Dict],
    bill_end_day: Optional[int] = None,
    home_id: str = None,
    uploaded_file_id: int = None,
    unusual_travel_dates: Optional[List[Dict]] = None,
    home_details: Optional[Dict] = None
) -> List[Dict]:
    """
    Convert monthly totals into 15-minute interval records.
    
    Args:
        monthly_rows: List of dicts like {month: '1', total: 1200.5, year: '2024'}
        bill_end_day: Day of month billing ends (1-31). If None, use calendar month.
        home_id: home_id to attach to output records
        uploaded_file_id: file ID to reference (optional)
        unusual_travel_dates: List of {start: 'YYYY-MM-DD', end: 'YYYY-MM-DD'}
        home_details: Dict with home characteristics for weather adjustment
    
    Returns:
        List of interval dicts: {home_id, timestamp, consumption, interval_minutes: 15, unit: 'kWh'}
    """
    
    if not monthly_rows:
        return []
    
    if home_details is None:
        home_details = {}
    
    unusual_travel_dates = unusual_travel_dates or []
    travel_ranges = _parse_travel_dates(unusual_travel_dates)
    
    # Group monthly data by month number
    monthly_dict = {}
    year = None
    for row in monthly_rows:
        month = int(row.get('month', 0))
        total_kwh = float(row.get('total', row.get('kwh', 0)))
        if 1 <= month <= 12:
            monthly_dict[month] = total_kwh
            if year is None and row.get('year'):
                year = int(row['year'])
    
    if not monthly_dict:
        logger.warning("No valid monthly data found")
        return []
    
    if year is None:
        year = datetime.now().year
    
    # Generate intervals for each month
    all_intervals = {}
    
    for month, total_kwh in monthly_dict.items():
        # Determine billing period
        if bill_end_day and 1 <= bill_end_day <= 31:
            start_date, end_date = _get_billing_period(year, month, bill_end_day)
        else:
            # Use calendar month
            start_date = datetime(year, month, 1, 0, 0, 0)
            last_day = calendar.monthrange(year, month)[1]
            end_date = datetime(year, month, last_day, 23, 59, 59)
        
        # Split month into 15-min buckets
        month_intervals = _split_to_15min_flat(
            start_date, end_date, total_kwh, travel_ranges, home_details
        )
        
        # Merge into global bucket dict
        for ts_key, kwh in month_intervals.items():
            all_intervals[ts_key] = all_intervals.get(ts_key, 0) + kwh
    
    # Convert bucket dict to output list
    result = []
    for ts_str, consumption in sorted(all_intervals.items()):
        if consumption > 0:  # Skip zero entries
            result.append({
                'home_id': home_id,
                'uploaded_file_id': uploaded_file_id,
                'timestamp': ts_str,  # Already ISO string
                'consumption': round(consumption, 4),
                'interval_minutes': 15,
                'unit': 'kWh'
            })
    
    logger.info(f"Converted {len(monthly_dict)} months into {len(result)} 15-min intervals")
    return result


def annual_to_intervals(
    annual_kwh: float,
    start_date_str: str,
    end_date_str: str,
    home_id: str = None,
    uploaded_file_id: int = None,
    unusual_travel_dates: Optional[List[Dict]] = None,
    home_details: Optional[Dict] = None
) -> List[Dict]:
    """
    Convert annual total into 15-minute interval records.
    
    Args:
        annual_kwh: Total annual consumption in kWh
        start_date_str: Start date as "YYYY-MM-DD"
        end_date_str: End date as "YYYY-MM-DD"
        home_id: home_id to attach
        uploaded_file_id: file ID to reference (optional)
        unusual_travel_dates: List of {start, end} date ranges
        home_details: Dict with home characteristics
    
    Returns:
        List of interval dicts
    """
    
    try:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
    except (ValueError, TypeError):
        logger.error(f"Invalid date format: {start_date_str}, {end_date_str}")
        return []
    
    if home_details is None:
        home_details = {}
    
    unusual_travel_dates = unusual_travel_dates or []
    travel_ranges = _parse_travel_dates(unusual_travel_dates)
    
    # Set times
    start_date = start_date.replace(hour=0, minute=0, second=0)
    end_date = end_date.replace(hour=23, minute=59, second=59)
    
    # Calculate daily average
    total_days = (end_date.date() - start_date.date()).days + 1
    daily_kwh = annual_kwh / total_days
    
    # Generate 15-min intervals
    all_intervals = {}
    current_date = start_date
    
    while current_date <= end_date:
        # Split this day into 15-min buckets
        day_start = current_date.replace(hour=0, minute=0, second=0)
        day_end = current_date.replace(hour=23, minute=45, second=0)
        
        day_intervals = _split_to_15min_flat(
            day_start, day_end, daily_kwh, travel_ranges, home_details
        )
        
        for ts_key, kwh in day_intervals.items():
            all_intervals[ts_key] = all_intervals.get(ts_key, 0) + kwh
        
        current_date += timedelta(days=1)
    
    # Convert to output list
    result = []
    for ts_str, consumption in sorted(all_intervals.items()):
        if consumption > 0:
            result.append({
                'home_id': home_id,
                'uploaded_file_id': uploaded_file_id,
                'timestamp': ts_str,
                'consumption': round(consumption, 4),
                'interval_minutes': 15,
                'unit': 'kWh'
            })
    
    logger.info(f"Converted annual {annual_kwh:.2f} kWh into {len(result)} intervals")
    return result


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _get_billing_period(year: int, month: int, bill_end_day: int) -> Tuple[datetime, datetime]:
    """
    Compute billing period (start, end) for a given month and billing day.
    
    If bill_end_day is 15, then:
      - March billing ends: March 15
      - March billing starts: Feb 16
    """
    
    # Clamp day to valid range for this month
    last_day = calendar.monthrange(year, month)[1]
    bill_end_day = min(bill_end_day, last_day)
    
    # End of billing period
    end_date = datetime(year, month, bill_end_day, 23, 59, 59)
    
    # Start: previous month's (bill_end_day + 1)
    if month == 1:
        prev_year, prev_month = year - 1, 12
    else:
        prev_year, prev_month = year, month - 1
    
    prev_last_day = calendar.monthrange(prev_year, prev_month)[1]
    bill_start_day = min(bill_end_day + 1, prev_last_day)
    
    start_date = datetime(prev_year, prev_month, bill_start_day, 0, 0, 0)
    
    return start_date, end_date


def _split_to_15min_flat(
    start_dt: datetime,
    end_dt: datetime,
    total_kwh: float,
    travel_ranges: List[Tuple],
    home_details: Dict
) -> Dict[str, float]:
    """
    Split a time range into 15-minute buckets with flat distribution.
    
    Returns:
        Dict mapping ISO timestamp string -> kWh for that bucket
    """
    
    # Calculate total minutes and 15-min intervals
    total_seconds = (end_dt - start_dt).total_seconds()
    total_minutes = total_seconds / 60
    num_intervals = int(round(total_minutes / 15))
    
    if num_intervals <= 0:
        return {}
    
    # Flat distribution: divide equally across all intervals
    per_interval_kwh = total_kwh / num_intervals
    
    # Generate bucket timestamps
    intervals = {}
    current = start_dt.replace(second=0, microsecond=0)
    
    # Round current down to nearest 15-min boundary
    minute = (current.minute // 15) * 15
    current = current.replace(minute=minute)
    
    while current <= end_dt:
        # Check if this timestamp is in a travel range
        if not _is_in_travel_range(current.date(), travel_ranges):
            # Create ISO string key (without timezone)
            ts_key = current.isoformat()
            intervals[ts_key] = per_interval_kwh
        
        current += timedelta(minutes=15)
    
    # If travel dates were excluded, re-normalize to preserve total
    travel_buckets = sum(
        1 for ts in intervals.keys() 
        if _is_in_travel_range(datetime.fromisoformat(ts).date(), travel_ranges)
    )
    
    if len(intervals) < num_intervals:
        # Re-distribute across remaining buckets
        remaining_intervals = len(intervals)
        if remaining_intervals > 0:
            adjusted_kwh = total_kwh / remaining_intervals
            for ts_key in intervals:
                intervals[ts_key] = adjusted_kwh
    
    return intervals


def _parse_travel_dates(unusual_travel_dates: List[Dict]) -> List[Tuple]:
    """
    Parse unusual travel dates into (start_date, end_date) tuples.
    
    Input: [{'start': 'YYYY-MM-DD', 'end': 'YYYY-MM-DD'}, ...]
    Output: [(date, date), ...]
    """
    
    ranges = []
    for travel in unusual_travel_dates:
        try:
            start = datetime.strptime(travel['start'], '%Y-%m-%d').date()
            end = datetime.strptime(travel['end'], '%Y-%m-%d').date()
            ranges.append((start, end))
        except (KeyError, ValueError):
            logger.warning(f"Invalid travel date range: {travel}")
    
    return ranges


def _is_in_travel_range(date, travel_ranges: List[Tuple]) -> bool:
    """Check if a date falls within any travel range."""
    
    for start, end in travel_ranges:
        if start <= date <= end:
            return True
    return False


# ============================================================================
# INTEGRATION FUNCTION (for API endpoints)
# ============================================================================

async def convert_manual_to_intervals_async(
    home_id: str,
    db_session,  # SQLAlchemy AsyncSession
    manual_type: str = 'monthly',  # 'monthly' or 'annual'
    uploaded_file_id: int = None
) -> Dict:
    """
    Fetch manual data from DB, normalize, and return interval list.
    
    Usage in FastAPI endpoint:
        result = await convert_manual_to_intervals_async(home_id, db_session, 'monthly')
        if result['success']:
            # Insert result['intervals'] into ConsumptionData table
    
    Returns:
        {
            'success': bool,
            'intervals': List[Dict],
            'monthly_total': float (if monthly input),
            'error': str (if failed)
        }
    """
    
    from sqlalchemy import select
    
    try:
        if manual_type == 'monthly':
            # Get monthly data
            from database.database import ManualMonthly, HomeDetails
            
            monthly_result = await db_session.execute(
                select(ManualMonthly).where(ManualMonthly.home_id == home_id)
            )
            monthly_rows = monthly_result.scalars().all()
            
            if not monthly_rows:
                return {'success': False, 'error': 'No monthly data found', 'intervals': []}
            
            # Get home details
            details_result = await db_session.execute(
                select(HomeDetails).where(HomeDetails.home_id == home_id)
            )
            home_details = details_result.scalar_one_or_none()
            
            home_details_dict = {
                'square_feet': home_details.square_feet or 2000,
                'insulation_type': home_details.insulation_type or 'standard',
                'window_type': home_details.window_type or 'double',
                'summer_temp': home_details.summer_temp or 72,
                'winter_temp': home_details.winter_temp or 68,
            } if home_details else {}
            
            # Convert to normalized rows
            monthly_data = [
                {
                    'month': str(row.month),
                    'total': row.total,
                    'year': datetime.now().year
                }
                for row in monthly_rows
            ]
            
            intervals = monthly_to_intervals(
                monthly_rows=monthly_data,
                bill_end_day=monthly_rows[0].day_of_bill if monthly_rows else None,
                home_id=home_id,
                uploaded_file_id=uploaded_file_id,
                unusual_travel_dates=_parse_unusual_travel(monthly_rows[0].unusual_travel_dates) if monthly_rows else None,
                home_details=home_details_dict
            )
            
            monthly_total = sum(row.total for row in monthly_rows)
            
            return {
                'success': True,
                'intervals': intervals,
                'monthly_total': monthly_total,
                'interval_count': len(intervals)
            }
        
        elif manual_type == 'annual':
            from database.database import ManualAnnual, HomeDetails
            
            annual_result = await db_session.execute(
                select(ManualAnnual).where(ManualAnnual.home_id == home_id)
            )
            annual_row = annual_result.scalar_one_or_none()
            
            if not annual_row:
                return {'success': False, 'error': 'No annual data found', 'intervals': []}
            
            details_result = await db_session.execute(
                select(HomeDetails).where(HomeDetails.home_id == home_id)
            )
            home_details = details_result.scalar_one_or_none()
            
            home_details_dict = {
                'square_feet': home_details.square_feet or 2000,
            } if home_details else {}
            
            intervals = annual_to_intervals(
                annual_kwh=annual_row.annual_usage,
                start_date_str=annual_row.start_date,
                end_date_str=annual_row.end_date,
                home_id=home_id,
                uploaded_file_id=uploaded_file_id,
                unusual_travel_dates=_parse_unusual_travel(annual_row.unusual_travel_dates),
                home_details=home_details_dict
            )
            
            return {
                'success': True,
                'intervals': intervals,
                'annual_total': annual_row.annual_usage,
                'interval_count': len(intervals)
            }
        
        else:
            return {'success': False, 'error': f'Unknown manual type: {manual_type}', 'intervals': []}
    
    except Exception as e:
        logger.error(f"Error converting manual to intervals: {str(e)}")
        return {'success': False, 'error': str(e), 'intervals': []}


def _parse_unusual_travel(travel_json_str: Optional[str]) -> List[Dict]:
    """Parse JSON string of travel dates."""
    if not travel_json_str:
        return []
    
    import json
    try:
        return json.loads(travel_json_str)
    except:
        return []
```

---

## Step 3: API Endpoint Integration

Add this to your FastAPI router:

```python
from fastapi import APIRouter, Depends, Form, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
from database import get_session, ConsumptionData
from utils.normalize_manual_to_intervals import convert_manual_to_intervals_async

router = APIRouter(prefix="/api")

@router.post("/convert_manual_to_intervals")
async def convert_manual_intervals(
    home_id: str = Form(...),
    manual_type: str = Form(...),  # 'monthly' or 'annual'
    db: AsyncSession = Depends(get_session)
):
    """
    Convert stored manual monthly/annual data into 15-minute intervals.
    
    Returns:
        {
            'success': bool,
            'intervals': List[{timestamp, consumption, interval_minutes, unit}],
            'interval_count': int,
            'message': str
        }
    """
    
    try:
        # Run conversion
        result = await convert_manual_to_intervals_async(home_id, db, manual_type)
        
        if not result['success']:
            return JSONResponse(
                status_code=400,
                content={
                    'success': False,
                    'error': result['error'],
                    'intervals': []
                }
            )
        
        intervals = result['intervals']
        
        # Optional: Insert into ConsumptionData (skip this if you want to do it separately)
        if intervals:
            consumption_records = [
                ConsumptionData(
                    home_id=home_id,
                    timestamp=datetime.fromisoformat(interval['timestamp']),
                    consumption=interval['consumption'],
                    interval_minutes=interval['interval_minutes'],
                    unit=interval['unit']
                )
                for interval in intervals
            ]
            
            db.add_all(consumption_records)
            await db.commit()
            
            logger.info(f"Inserted {len(consumption_records)} interval records for home {home_id}")
        
        return {
            'success': True,
            'interval_count': len(intervals),
            'message': f'Converted {manual_type} data into {len(intervals)} intervals',
            'intervals': intervals[:100]  # Return first 100 as preview
        }
    
    except Exception as e:
        logger.error(f"Error in convert_manual_intervals: {str(e)}")
        await db.rollback()
        return JSONResponse(
            status_code=500,
            content={'success': False, 'error': str(e), 'intervals': []}
        )
```

---

## Step 4: Update Your Existing Endpoints

Hook normalization into `/save_monthly_usage` and `/save_annual_usage`:

```python
@router.post("/save_monthly_usage")
async def save_monthly_usage(request: Request, db: AsyncSession = Depends(get_session)):
    """Save monthly data and auto-convert to intervals."""
    
    try:
        data = await request.json()
        home_id = data.get("home_id")
        monthly_data = data.get("monthly_data", [])
        bill_end_day = data.get("bill_end_day")
        unusual_travel_dates = data.get("unusual_travel_dates", [])
        
        # ... existing validation code ...
        
        # Save monthly rows
        for record in monthly_data:
            new_record = ManualMonthly(
                home_id=home_id,
                month=record.get("month"),
                total=record.get("kwh"),
                unusual_travel_dates=json.dumps(unusual_travel_dates),
                day_of_bill=bill_end_day
            )
            db.add(new_record)
        
        await db.commit()
        
        # NOW: Convert to intervals
        conversion_result = await convert_manual_to_intervals_async(home_id, db, 'monthly')
        
        if conversion_result['success']:
            intervals = conversion_result['intervals']
            
            # Insert into ConsumptionData
            consumption_records = [
                ConsumptionData(
                    home_id=home_id,
                    timestamp=datetime.fromisoformat(interval['timestamp']),
                    consumption=interval['consumption'],
                    interval_minutes=15,
                    unit='kWh'
                )
                for interval in intervals
            ]
            
            db.add_all(consumption_records)
            await db.commit()
            
            logger.info(f"✅ Saved {len(consumption_records)} interval records")
        
        return {'success': True, 'intervals_generated': len(conversion_result.get('intervals', []))}
    
    except Exception as e:
        await db.rollback()
        logger.error(f"Error: {str(e)}")
        return JSONResponse(status_code=500, content={'success': False, 'error': str(e)})
```

---

## Step 5: Testing

Create a test script: `tests/test_normalization.py`

```python
import pytest
from datetime import datetime, timedelta
from backend.utils.normalize_manual_to_intervals import (
    monthly_to_intervals,
    annual_to_intervals,
    _get_billing_period,
)

def test_monthly_flat_distribution():
    """Test monthly data converts to 15-min intervals."""
    
    monthly_rows = [
        {'month': '1', 'total': 1200.0, 'year': '2024'},
        {'month': '2', 'total': 1100.0, 'year': '2024'},
    ]
    
    result = monthly_to_intervals(
        monthly_rows=monthly_rows,
        home_id='test-home',
        bill_end_day=None,  # Use calendar month
    )
    
    # Check we got intervals
    assert len(result) > 0
    
    # Check each interval has required fields
    for interval in result:
        assert 'timestamp' in interval
        assert 'consumption' in interval
        assert interval['interval_minutes'] == 15
        assert interval['unit'] == 'kWh'
    
    # Check totals match
    total_kwh = sum(i['consumption'] for i in result)
    assert abs(total_kwh - 2300.0) < 1.0  # Allow 1 kWh rounding error


def test_annual_to_15min():
    """Test annual data converts to 15-min intervals."""
    
    result = annual_to_intervals(
        annual_kwh=10950.0,  # 365 days * 30 kWh/day
        start_date_str='2024-01-01',
        end_date_str='2024-12-31',
        home_id='test-home',
    )
    
    assert len(result) > 0
    
    # Each day should have 96 intervals (24h * 4 per hour)
    # 365 days * 96 = 35040 intervals
    assert abs(len(result) - 35040) < 100
    
    # Total should match
    total = sum(i['consumption'] for i in result)
    assert abs(total - 10950.0) < 10.0


def test_billing_period():
    """Test billing period calculation."""
    
    # Bill ends on 15th
    start, end = _get_billing_period(2024, 3, 15)
    
    # Should be Feb 16 - Mar 15
    assert start.month == 2
    assert start.day == 16
    assert end.month == 3
    assert end.day == 15


if __name__ == '__main__':
    test_monthly_flat_distribution()
    test_annual_to_15min()
    test_billing_period()
    print("✅ All tests passed!")
```

Run with: `pytest tests/test_normalization.py -v`

---

## Step 6: Usage Examples

### Example 1: Convert monthly data for a home

```python
# In your application
from utils.normalize_manual_to_intervals import monthly_to_intervals

monthly_data = [
    {'month': '1', 'total': 1500, 'year': 2024},
    {'month': '2', 'total': 1400, 'year': 2024},
    {'month': '3', 'total': 1200, 'year': 2024},
]

intervals = monthly_to_intervals(
    monthly_rows=monthly_data,
    home_id='home-uuid-123',
    bill_end_day=15,  # Bill ends on 15th of each month
    unusual_travel_dates=[
        {'start': '2024-01-15', 'end': '2024-01-22'},  # Vacation
    ]
)

print(f"Generated {len(intervals)} intervals")
for interval in intervals[:5]:
    print(interval)
```

### Example 2: Auto-convert in FastAPI endpoint

```python
@router.post("/save_annual_usage")
async def save_annual_usage(request: Request, db: AsyncSession = Depends(get_session)):
    data = await request.json()
    home_id = data['home_id']
    
    # Save ManualAnnual record
    annual = ManualAnnual(
        home_id=home_id,
        annual_usage=data['total_kwh'],
        start_date=data['start_date'],
        end_date=data['end_date'],
        unusual_travel_dates=json.dumps(data.get('unusual_travel_dates', []))
    )
    db.add(annual)
    await db.commit()
    
    # Auto-convert to intervals
    result = await convert_manual_to_intervals_async(home_id, db, 'annual')
    
    if result['success']:
        # Insert intervals
        intervals = result['intervals']
        db.add_all([
            ConsumptionData(
                home_id=home_id,
                timestamp=datetime.fromisoformat(i['timestamp']),
                consumption=i['consumption'],
                interval_minutes=15,
                unit='kWh'
            )
            for i in intervals
        ])
        await db.commit()
    
    return {'success': True, 'interval_count': result['interval_count']}
```

---

## Summary: Files to Create/Copy

1. **`backend/utils/normalize_manual_to_intervals.py`** — Core normalization logic (from Step 2 above)
2. **Database models** in your `database.py` — ManualMonthly, ManualAnnual, ConsumptionData, HomeDetails
3. **API endpoint** in your router — `/convert_manual_to_intervals` and hook into `save_monthly_usage` / `save_annual_usage`
4. **Tests** — `tests/test_normalization.py`

---

## Key Differences from Original

The provided code **simplifies** the original `simulation.py` by:
- Removing weather API dependency (uses flat distribution instead)
- Removing time-of-day peak modeling (could be added back if needed)
- Keeping just the core monthly/annual → 15min algorithm
- More portable and testable

If you need weather-aware distribution (more realistic peaks/valleys), you can port the `calculate_base_energy()` and weather functions from the original `simulation.py`.

---

## Troubleshooting

**Q: Intervals don't sum to monthly total?**
A: Check unusual_travel_dates logic. If travel ranges exclude buckets, remaining buckets get re-weighted. Verify travel date parsing.

**Q: Timestamps are wrong timezone?**
A: The code uses naive ISO strings (no tz info). Adapt `_split_to_15min_flat()` to use UTC if needed:
```python
ts_key = current.replace(tzinfo=timezone.utc).isoformat()
```

**Q: How do I use shaped/profile-based distribution?**
A: Port `calculate_base_energy()` and `get_time_factor()` from original `simulation.py`. Then modify `_split_to_15min_flat()` to apply hourly/daily shapes instead of uniform distribution.

---

End of Instructions
