import { describe, expect, it } from "vitest";

import { extractCurrentPlanFromBillText } from "@/lib/billing/parseBillText";

const GEXA_BILL_OCR_TEXT = `www.gexaenergy.com
Gexa ENERGr
STACIE SQUIER
1014 DENTON DR
EULESS, TX 76039
Invoice - Account Summary
Gexa Energy
Hou Tran, X 002 1400
Account No.
Amount Du
I paid by due dat
Due Date
36357414
$219.50
02/09/2026
Account summary (see second page for details)
Invoice date: Jan 23 2026, Invoice No: 33631350
Opening Balance	$134.06
Payment Received Jan 15, 2026	$-165.76
Disconnection Notice Fee	$25.00
Late Payment Penalty	$6.70
Balance Forward	$0.00
Electricity Charges and Taxes (see second page for details)	$159.93
TDU Charges and Taxes (see second page for details)	$59.57
Total Current Charges	$219.50
Total Amount Due	$219.50
5.0% Late Payment Penalty (if paid after 02/09/2026)	$10.97
Total Amount Due with Late Payment Penalty (if paid after due date)	$230.47
Your Average Daily Billed Usage
Elmmalllml
Feb/25
Арг/25
Jun/25
Jul/25
ht
~
920
Jan/26
This period billed usage: 948 kWh
Previous 13 months billed usage: 10,639 kWh
For more information about residential electric service please visit www.powertochoose.com
Please allow 5 to 7 days for processing. Detach and return this portion with your payment.
Gexa ENERGY
Account No.
Invoice No.
Amount due
36357414
33631350
$219.50
BILL PAYMENT ASSISTANCE
■$
Due Date
02/09/2026
Amount Enclosed
$
0363574143
Dallas, TX 75266-0100
00021950

Page 2 of 2
Electricity Usage Details
Meter Reading Information
Meter Number
114774484LG
ESI: 10443720001369831, Address: 01014 DENTON DR, EULESS, TX 76039
Meter Read Date
Read Type
Previous
Meter Read
12/20/2025 - 01/22/2026
Actual
66753
Current
Meter Read
Multi
67701 |
1
Total Usage
kWh
Usage
948
948
Electricity Charges and Taxes
Billing Period: 12/20/2025 - 01/22/2026
*Energy Charge
Units
948
Rate $
0.161900
PUC Assessment
Gross Receipts Reimb
Sales Tax - City
Sales Tax - Other/Special
Total Electricity Charges and Taxes
TDU Charges and Taxes
Billing Period: 12/20/2025 - 01/22/2026
Units
Rate $
*DU Delivery Charges
PUC Assessment
Gross Receipts Reimb
Sales Tax - City
Sales Tax - Other/Special
Total TDU Charges and Taxes
Total $
$153.48
$0.26
$3.06
$2.74
$0.39
$159.93
Total $
$57.16
$0.09
$1.15
$1.03
$0.14
$59.57
*These items are included in the calculation of the average price per kWh. The average price you paid for electric service this month is 22.2 cents per kWh. The amount billed may include price changes allowed by law or regulatory actions.
ESI: 10443720001369831, Address: 01014 DENTON DR, EULESS, TX 76039
The estimated contract end date is 10/03/2027
Important Messages:
No important messages at this time.
Customer Service: 1-866-961-9399
Mon-Fri 7:00am-8:00pm Sat 8:00am-5:00pm
Electricity Outages: 1-888-313-4747
24 Hours
Web: www.gexaenergy.com
Payment: Gexa Energy, PO Box 660100,
Dallas, TX 75266-0100
Text BALANCE to 20145 to receive account details via SMS
@
Email: Customercare@gexaenergy.com
Gexa Energy PUCT Certificate #10027|`;

describe("extractCurrentPlanFromBillText", () => {
  it("extracts baseline fields from noisy Gexa OCR text", () => {
    const parsed = extractCurrentPlanFromBillText(GEXA_BILL_OCR_TEXT);

    expect(parsed.esiid).toBe("10443720001369831");
    expect(parsed.meterNumber).toBe("114774484LG");
    expect(parsed.providerName).toBe("Gexa Energy");
    expect(parsed.accountNumber).toBe("36357414");
    expect(parsed.customerName).toBe("Stacie Squier");
    expect(parsed.serviceAddressLine1).toBe("1014 DENTON DR");
    expect(parsed.serviceAddressCity).toBe("Euless");
    expect(parsed.serviceAddressState).toBe("TX");
    expect(parsed.serviceAddressZip).toBe("76039");
    expect(parsed.billingPeriodStart).toBe("2025-12-20");
    expect(parsed.billingPeriodEnd).toBe("2026-01-22");
    expect(parsed.billIssueDate).toBe("2026-01-23");
    expect(parsed.billDueDate).toBe("2026-02-09");
    expect(parsed.totalAmountDueCents).toBe(21_950);
    expect(parsed.contractEndDate).toBe("2027-10-03");
  });
});
