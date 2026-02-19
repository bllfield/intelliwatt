/**
 * Single source of truth for upgrade types (allowlist). Server-safe; no React.
 * Used for validation and UI grouping. Do not prune; complete superset V1.
 */

export const UPGRADE_CHANGE_TYPES = ["ADD", "REMOVE", "REPLACE", "MODIFY"] as const;
export type ChangeType = (typeof UPGRADE_CHANGE_TYPES)[number];
/** @deprecated Use UPGRADE_CHANGE_TYPES */
export const CHANGE_TYPES = UPGRADE_CHANGE_TYPES;

export type UpgradeCatalogEntry = {
  key: string;
  label: string;
  units?: string;
  /** Minimal field template for before/after/inputs (for UI hints only; stored in JSON). */
  beforeTemplate?: Record<string, string>;
  afterTemplate?: Record<string, string>;
  inputsTemplate?: Record<string, string>;
};

export type UpgradeCatalogGroup = {
  label: string;
  types: UpgradeCatalogEntry[];
};

/** All upgrade types by group. Keys are stable upgradeType values for DB/API. */
export const UPGRADE_CATALOG_GROUPS: UpgradeCatalogGroup[] = [
  {
    label: "Envelope / Shell",
    types: [
      { key: "WINDOW_REPLACEMENT", label: "Window replacement", units: "windows", beforeTemplate: { paneType: "", lowE: "", frameType: "", notes: "" }, afterTemplate: { paneType: "", lowE: "", frameType: "", notes: "" } },
      { key: "DOOR_REPLACEMENT", label: "Door replacement" },
      { key: "WINDOW_FILM_TINT", label: "Window film / tint" },
      { key: "EXTERIOR_SHADING_AWNINGS_SCREENS", label: "Exterior shading / awnings / screens" },
      { key: "AIR_SEALING_WEATHERSTRIP", label: "Air sealing / weatherstrip" },
      { key: "ATTIC_INSULATION", label: "Attic insulation", units: "sqft", beforeTemplate: { rValue: "", depthInches: "", coverageSqft: "" }, afterTemplate: { rValue: "", depthInches: "", coverageSqft: "" } },
      { key: "WALL_INSULATION", label: "Wall insulation" },
      { key: "FLOOR_CRAWLSPACE_INSULATION", label: "Floor / crawlspace insulation" },
      { key: "RADIANT_BARRIER", label: "Radiant barrier" },
      { key: "ATTIC_VENTILATION", label: "Attic ventilation" },
      { key: "ROOF_COLOR_COOL_ROOF", label: "Roof color / cool roof" },
      { key: "DUCT_SEALING", label: "Duct sealing" },
      { key: "DUCT_INSULATION", label: "Duct insulation" },
      { key: "DUCT_REPLACEMENT_REROUTE", label: "Duct replacement / reroute" },
    ],
  },
  {
    label: "HVAC / Comfort Systems",
    types: [
      { key: "HVAC_REPLACEMENT_SEER_UPGRADE", label: "HVAC replacement / SEER upgrade", beforeTemplate: { systemType: "", heatSource: "", seer: "", seer2: "", tonnage: "", stages: "", inverter: "", ageYears: "" }, afterTemplate: { systemType: "", heatSource: "", seer: "", seer2: "", tonnage: "", stages: "", inverter: "", ageYears: "" } },
      { key: "HEAT_STRIP_TO_HEAT_PUMP_SWAP", label: "Heat strip to heat pump swap" },
      { key: "GAS_FURNACE_TO_HEAT_PUMP_SWAP", label: "Gas furnace to heat pump swap" },
      { key: "MINI_SPLIT_ADD_OR_REPLACE", label: "Mini-split add or replace" },
      { key: "ZONING_ADD", label: "Zoning add" },
      { key: "WHOLE_HOUSE_FAN", label: "Whole house fan" },
      { key: "WHOLE_HOME_DEHUMIDIFIER", label: "Whole-home dehumidifier" },
      { key: "ERV_HRV_VENTILATION", label: "ERV / HRV ventilation" },
      { key: "HVAC_MAINTENANCE_FIX", label: "HVAC maintenance / fix" },
      { key: "THERMOSTAT_DEVICE_INSTALL", label: "Thermostat device install", beforeTemplate: { hasSmartThermostat: "", brand: "", model: "" }, afterTemplate: { hasSmartThermostat: "", brand: "", model: "" }, inputsTemplate: { setpoints: "", schedule: "", occupancyControl: "", geofencing: "", notes: "" } },
      { key: "THERMOSTAT_SETPOINT_SCHEDULE_CHANGE", label: "Thermostat setpoint / schedule change" },
    ],
  },
  {
    label: "Water Heating / Hot Water",
    types: [
      { key: "WATER_HEATER_REPLACEMENT", label: "Water heater replacement" },
      { key: "ELECTRIC_TANK_TO_HPWH", label: "Electric tank to heat pump water heater" },
      { key: "TANK_TO_TANKLESS", label: "Tank to tankless" },
      { key: "RECIRC_PUMP_ADD_REMOVE", label: "Recirc pump add/remove" },
      { key: "WATER_HEATER_SETPOINT_CHANGE", label: "Water heater setpoint change" },
      { key: "HOT_WATER_LEAK_FIX", label: "Hot water leak fix" },
    ],
  },
  {
    label: "Lighting",
    types: [
      { key: "LED_LIGHTING_UPGRADE", label: "LED lighting upgrade", inputsTemplate: { percentConverted: "", bulbsConverted: "", bulbTypeBefore: "", bulbTypeAfter: "" } },
      { key: "LIGHTING_ADDED_LOAD", label: "Lighting added load" },
      { key: "LIGHTING_AUTOMATION_OCC_SENSORS", label: "Lighting automation / occupancy sensors" },
    ],
  },
  {
    label: "Major Appliances",
    types: [
      { key: "REFRIGERATOR_REPLACEMENT", label: "Refrigerator replacement" },
      { key: "SECOND_FRIDGE_FREEZER_ADD_REMOVE", label: "Second fridge/freezer add/remove" },
      { key: "DISHWASHER_REPLACEMENT", label: "Dishwasher replacement" },
      { key: "WASHER_REPLACEMENT", label: "Washer replacement" },
      { key: "DRYER_REPLACEMENT_OR_FUEL_CHANGE", label: "Dryer replacement or fuel change" },
      { key: "OVEN_RANGE_REPLACEMENT_OR_FUEL_CHANGE", label: "Oven/range replacement or fuel change" },
      { key: "MICROWAVE_REPLACEMENT", label: "Microwave replacement" },
      { key: "STANDALONE_FREEZER_ADD_REMOVE", label: "Standalone freezer add/remove" },
      { key: "WINE_FRIDGE_ADD_REMOVE", label: "Wine fridge add/remove" },
      { key: "ICE_MAKER_ADD_REMOVE", label: "Ice maker add/remove" },
      { key: "GARBAGE_DISPOSAL_ADD_REMOVE", label: "Garbage disposal add/remove" },
      { key: "VENT_HOOD_ADD_REMOVE", label: "Vent hood add/remove" },
    ],
  },
  {
    label: "EV / Transportation",
    types: [
      { key: "EV_PURCHASED_ADD_LOAD", label: "EV purchased (add load)", beforeTemplate: { vehicleModel: "", efficiencyWhPerMile: "", milesPerDay: "", chargerType: "", chargeSchedule: "", location: "" }, afterTemplate: { vehicleModel: "", efficiencyWhPerMile: "", milesPerDay: "", chargerType: "", chargeSchedule: "", location: "" } },
      { key: "EV_SOLD_REMOVE_LOAD", label: "EV sold (remove load)" },
      { key: "EV_REPLACED", label: "EV replaced", beforeTemplate: { vehicleModel: "", efficiencyWhPerMile: "", milesPerDay: "", chargerType: "", chargeSchedule: "", location: "" }, afterTemplate: { vehicleModel: "", efficiencyWhPerMile: "", milesPerDay: "", chargerType: "", chargeSchedule: "", location: "" } },
      { key: "EV_CHARGER_INSTALL_OR_CHANGE", label: "EV charger install or change" },
      { key: "EV_CHARGING_SCHEDULE_CHANGE", label: "EV charging schedule change" },
      { key: "DAILY_MILES_CHANGED", label: "Daily miles changed" },
      { key: "SECOND_EV_ADD_REMOVE", label: "Second EV add/remove" },
    ],
  },
  {
    label: "Pool / Spa / Outdoor",
    types: [
      { key: "POOL_PUMP_REPLACEMENT", label: "Pool pump replacement" },
      { key: "POOL_PUMP_SCHEDULE_CHANGE", label: "Pool pump schedule change" },
      { key: "POOL_HEATER_ADD_REMOVE", label: "Pool heater add/remove" },
      { key: "HOT_TUB_SPA_ADD_REMOVE", label: "Hot tub / spa add/remove" },
      { key: "WATER_FEATURE_PUMPS_ADD_REMOVE", label: "Water feature pumps add/remove" },
      { key: "POOL_LIGHTING_SCHEDULE", label: "Pool lighting schedule" },
    ],
  },
  {
    label: "Plug Loads / Special Equipment",
    types: [
      { key: "SPACE_HEATER_ADD_REMOVE", label: "Space heater add/remove" },
      { key: "WINDOW_AC_ADD_REMOVE", label: "Window AC add/remove" },
      { key: "PORTABLE_DEHUMIDIFIER_ADD_REMOVE", label: "Portable dehumidifier add/remove" },
      { key: "HOME_SERVER_HOME_LAB_ADD_REMOVE", label: "Home server / home lab add/remove" },
      { key: "AQUARIUM_SYSTEM_ADD_REMOVE", label: "Aquarium system add/remove" },
      { key: "WORKSHOP_EQUIPMENT_ADD_REMOVE", label: "Workshop equipment add/remove" },
      { key: "HIGH_COMPUTE_MINING_ADD_REMOVE", label: "High compute / mining add/remove" },
      { key: "IRRIGATION_PUMP_ADD_REMOVE", label: "Irrigation pump add/remove" },
      { key: "WELL_PUMP_ADD_REMOVE", label: "Well pump add/remove" },
      { key: "SUMP_PUMP_ADD_REMOVE", label: "Sump pump add/remove" },
    ],
  },
  {
    label: "Occupancy / Behavior",
    types: [
      { key: "OCCUPANTS_MOVED_IN_OUT", label: "Occupants moved in/out", inputsTemplate: { occupantsTotalBefore: "", occupantsTotalAfter: "", homeAllDayBefore: "", homeAllDayAfter: "", workBefore: "", workAfter: "", schoolBefore: "", schoolAfter: "" } },
      { key: "WORK_FROM_HOME_CHANGE", label: "Work from home change" },
      { key: "SCHOOL_SCHEDULE_CHANGE", label: "School schedule change" },
      { key: "NEW_BABY_HOUSEHOLD_CHANGE", label: "New baby / household change" },
      { key: "CAREGIVER_ELDER_MOVED_IN", label: "Caregiver / elder moved in" },
      { key: "AIRBNB_RENTAL_MODE", label: "Airbnb / rental mode" },
      { key: "PETS_ADDED_REMOVED", label: "Pets added/removed" },
      { key: "BEHAVIOR_TIME_SHIFT_LAUNDRY_DISHWASHER", label: "Behavior time shift (laundry/dishwasher)" },
      { key: "COOKING_FREQUENCY_CHANGE", label: "Cooking frequency change" },
    ],
  },
  {
    label: "Solar / Battery / Export",
    types: [
      { key: "SOLAR_INSTALLED", label: "Solar installed", inputsTemplate: { solarKwDc: "", inverterType: "", orientation: "", azimuth: "", productionSource: "", batteryModel: "", batteryKwhUsable: "", batteryMode: "", exportPlanType: "", tdspRegion: "" } },
      { key: "SOLAR_REMOVED", label: "Solar removed" },
      { key: "SOLAR_EXPANSION_ADD_PANELS", label: "Solar expansion / add panels" },
      { key: "BATTERY_INSTALLED", label: "Battery installed" },
      { key: "BATTERY_REMOVED", label: "Battery removed" },
      { key: "BATTERY_MODE_CHANGE", label: "Battery mode change" },
      { key: "EXPORT_PLAN_TYPE_CHANGE", label: "Export plan type change" },
      { key: "TDSP_REGION_DELIVERY_CHARGES_CONTEXT", label: "TDSP region / delivery charges context" },
    ],
  },
  {
    label: "Remodel / Structural",
    types: [
      { key: "SQUARE_FOOTAGE_ADDITION_REMODEL", label: "Square footage addition / remodel" },
      { key: "MAJOR_REMODEL_USAGE_SHIFT", label: "Major remodel usage shift" },
    ],
  },
];

// Flatten for allowlist lookup (no pruning)
const _allKeys = new Set<string>();
for (const g of UPGRADE_CATALOG_GROUPS) {
  for (const t of g.types) _allKeys.add(t.key);
}

export function isAllowedUpgradeType(key: string): boolean {
  return _allKeys.has(String(key));
}

export function isAllowedChangeType(key: string): key is ChangeType {
  return UPGRADE_CHANGE_TYPES.includes(key as ChangeType);
}

/** Allowlist check for upgradeType. Alias for isAllowedUpgradeType. */
export const isUpgradeType = isAllowedUpgradeType;
