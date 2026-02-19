/**
 * Single source of truth for upgrade types: template-driven (requiredPaths + fields).
 * Server-safe; no React. Used for validation and UI.
 */

import type { FieldDescriptor, UpgradeTemplate } from "./catalog-types";
import {
  UPGRADE_CHANGE_TYPES,
  type ChangeType,
} from "./catalog-types";

// ---------------------------------------------------------------------------
// Common option sets (stable string conventions; UNKNOWN allowed)
// ---------------------------------------------------------------------------
const OPT_UNKNOWN = ["UNKNOWN"];
const OPT_YES_NO_UNKNOWN = ["YES", "NO", "UNKNOWN"];
const OPT_PANE = ["SINGLE", "DOUBLE", "TRIPLE", "UNKNOWN"];
const OPT_FRAME = ["VINYL", "WOOD", "ALUMINUM", "FIBERGLASS", "UNKNOWN"];
const OPT_DOOR = ["SOLID", "HOLLOW", "GLASS", "UNKNOWN"];
const OPT_LEAKINESS = ["DRAFTY", "AVERAGE", "TIGHT", "UNKNOWN"];
const OPT_DUCT_CONDITION = ["LEAKY", "AVERAGE", "GOOD", "POOR", "NEW", "UNKNOWN"];
const OPT_SYSTEM = ["CENTRAL", "PACKAGE", "MINI_SPLIT", "UNKNOWN"];
const OPT_HEAT_SOURCE = ["HEAT_PUMP", "HEAT_STRIP", "GAS_FURNACE", "UNKNOWN"];
const OPT_STAGES = ["1", "2", "VARIABLE", "UNKNOWN"];
const OPT_THERMOSTAT_BRAND = ["NEST", "ECOBEE", "HONEYWELL", "SENSI", "OTHER", "UNKNOWN"];
const OPT_SCHEDULE_TYPE = ["SIMPLE", "DETAILED", "UNKNOWN"];
const OPT_WATER_TYPE = ["ELECTRIC_TANK", "GAS_TANK", "TANKLESS", "HPWH", "UNKNOWN"];
const OPT_HPWH_MODE = ["EFFICIENCY", "HYBRID", "HIGH_DEMAND", "UNKNOWN"];
const OPT_BULB = ["INCANDESCENT", "HALOGEN", "CFL", "LED", "MIXED", "UNKNOWN"];
const OPT_FUEL = ["ELECTRIC", "GAS", "UNKNOWN"];
const OPT_CHARGER = ["LEVEL1", "LEVEL2", "UNKNOWN"];
const OPT_CHARGE_SCHEDULE = ["NIGHT", "DAY", "MIXED", "CUSTOM", "UNKNOWN"];
const OPT_PUMP_TYPE = ["SINGLE_STAGE", "TWO_STAGE", "VARIABLE_SPEED", "UNKNOWN"];
const OPT_SEASON = ["SUMMER", "WINTER", "YEAR_ROUND", "UNKNOWN"];
const OPT_ACTION = ["ADD", "REMOVE", "UNKNOWN"];
const OPT_IMPACT = ["LOW", "MED", "HIGH", "UNKNOWN"];
const OPT_EXPORT_PLAN = ["NET_METERING", "BUYBACK_MATCH", "FIXED_CREDIT", "TOU_CREDITS", "NO_EXPORT", "UNKNOWN"];
const OPT_CREDIT_RATE = ["RETAIL", "WHOLESALE", "TIERED", "UNKNOWN"];
const OPT_TDSP = ["ONCOR", "CNP", "AEP_NORTH", "AEP_CENTRAL", "TNMP", "UNKNOWN"];
const OPT_INSULATION = ["FIBERGLASS", "CELLULOSE", "SPRAY_FOAM_OPEN", "SPRAY_FOAM_CLOSED", "MINERAL_WOOL", "UNKNOWN"];
const OPT_VENT = ["PASSIVE", "POWERED", "WHIRLYBIRD", "UNKNOWN"];
const OPT_ROOF_COLOR = ["DARK", "MEDIUM", "LIGHT", "UNKNOWN"];
const OPT_LOCATION = ["ATTIC", "CRAWLSPACE", "IN_WALL", "GARAGE", "UTILITY", "KITCHEN", "OTHER", "UNKNOWN"];

function f(path: string, label: string, type: FieldDescriptor["type"], opts?: { options?: string[]; required?: boolean }): FieldDescriptor {
  return { path, label, type, options: opts?.options, required: opts?.required ?? false };
}

// ---------------------------------------------------------------------------
// All upgrade templates (requiredPaths + fields). Groups 1–11.
// ---------------------------------------------------------------------------
const UPGRADE_TEMPLATES: UpgradeTemplate[] = [
  // ---- Group 1: Envelope / Shell ----
  {
    key: "WINDOW_REPLACEMENT",
    label: "Window replacement",
    group: "Envelope / Shell",
    defaultUnits: "windows",
    requiresQuantity: true,
    requiredPaths: ["quantity", "units", "before.paneType", "after.paneType", "after.lowE"],
    fields: [
      f("quantity", "Quantity", "number", { required: true }),
      f("units", "Units", "text", { required: true }),
      f("before.paneType", "Before pane type", "select", { options: OPT_PANE, required: true }),
      f("after.paneType", "After pane type", "select", { options: OPT_PANE, required: true }),
      f("after.lowE", "After Low-E", "select", { options: OPT_YES_NO_UNKNOWN, required: true }),
      f("inputs.conditionedSqftAffected", "Conditioned sqft affected", "number"),
      f("before.frameType", "Before frame", "select", { options: OPT_FRAME }),
      f("after.frameType", "After frame", "select", { options: OPT_FRAME }),
    ],
  },
  {
    key: "DOOR_REPLACEMENT",
    label: "Door replacement",
    group: "Envelope / Shell",
    defaultUnits: "doors",
    requiresQuantity: true,
    requiredPaths: ["quantity", "units", "before.doorType", "after.doorType", "inputs.weatherstrippingIncluded"],
    fields: [
      f("quantity", "Quantity", "number", { required: true }),
      f("units", "Units", "text", { required: true }),
      f("before.doorType", "Before door type", "select", { options: OPT_DOOR, required: true }),
      f("after.doorType", "After door type", "select", { options: OPT_DOOR, required: true }),
      f("inputs.weatherstrippingIncluded", "Weatherstripping included", "select", { options: OPT_YES_NO_UNKNOWN, required: true }),
      f("inputs.doorUsage", "Door usage", "select", { options: ["PRIMARY", "SECONDARY", "GARAGE", "UNKNOWN"] }),
    ],
  },
  {
    key: "WINDOW_FILM_TINT",
    label: "Window film / tint",
    group: "Envelope / Shell",
    requiresQuantity: false,
    requiredPaths: ["inputs.coveragePercent", "inputs.filmType"],
    fields: [
      f("inputs.coveragePercent", "Coverage %", "percent", { required: true }),
      f("inputs.filmType", "Film type", "select", { options: ["CLEAR_UV", "HEAT_REJECTING", "PRIVACY", "UNKNOWN"], required: true }),
      f("quantity", "Quantity (windows or sqft)", "number"),
      f("units", "Units", "text"),
    ],
  },
  {
    key: "EXTERIOR_SHADING_AWNINGS_SCREENS",
    label: "Exterior shading / awnings / screens",
    group: "Envelope / Shell",
    requiresQuantity: false,
    requiredPaths: ["inputs.shadingType", "inputs.coveragePercent"],
    fields: [
      f("inputs.shadingType", "Shading type", "select", { options: ["SCREENS", "AWNINGS", "SHADES", "TREES", "OTHER", "UNKNOWN"], required: true }),
      f("inputs.coveragePercent", "Coverage %", "percent", { required: true }),
      f("inputs.facings", "Facings (N/S/E/W)", "text"),
    ],
  },
  {
    key: "AIR_SEALING_WEATHERSTRIP",
    label: "Air sealing / weatherstrip",
    group: "Envelope / Shell",
    requiresQuantity: false,
    requiredPaths: ["before.airLeakiness", "after.airLeakiness", "inputs.scope"],
    fields: [
      f("before.airLeakiness", "Before air leakiness", "select", { options: OPT_LEAKINESS, required: true }),
      f("after.airLeakiness", "After air leakiness", "select", { options: OPT_LEAKINESS, required: true }),
      f("inputs.scope", "Scope", "select", { options: ["DOORS_WINDOWS", "ATTIC_BYPASSES", "DUCTS", "WHOLE_HOME", "UNKNOWN"], required: true }),
    ],
  },
  {
    key: "ATTIC_INSULATION",
    label: "Attic insulation",
    group: "Envelope / Shell",
    defaultUnits: "sqft",
    requiresQuantity: false,
    requiredPaths: ["inputs.insulationType", "after.rValue", "inputs.coveragePercent"],
    fields: [
      f("inputs.insulationType", "Insulation type", "select", { options: OPT_INSULATION, required: true }),
      f("after.rValue", "After R-value", "number", { required: true }),
      f("inputs.coveragePercent", "Coverage %", "percent", { required: true }),
      f("quantity", "Coverage sqft", "number"),
      f("units", "Units", "text"),
      f("before.rValue", "Before R-value", "number"),
    ],
  },
  {
    key: "WALL_INSULATION",
    label: "Wall insulation",
    group: "Envelope / Shell",
    requiresQuantity: false,
    requiredPaths: ["after.rValue", "inputs.insulationType", "inputs.coveragePercent", "inputs.wallType"],
    fields: [
      f("after.rValue", "After R-value", "number", { required: true }),
      f("inputs.insulationType", "Insulation type", "select", { options: OPT_INSULATION, required: true }),
      f("inputs.coveragePercent", "Coverage %", "percent", { required: true }),
      f("inputs.wallType", "Wall type", "select", { options: ["2X4", "2X6", "UNKNOWN"], required: true }),
    ],
  },
  {
    key: "FLOOR_CRAWLSPACE_INSULATION",
    label: "Floor / crawlspace insulation",
    group: "Envelope / Shell",
    requiresQuantity: false,
    requiredPaths: ["inputs.foundationType", "after.rValue", "inputs.coveragePercent"],
    fields: [
      f("inputs.foundationType", "Foundation type", "select", { options: ["CRAWLSPACE", "PIER_BEAM", "BASEMENT", "UNKNOWN"], required: true }),
      f("after.rValue", "After R-value", "number", { required: true }),
      f("inputs.coveragePercent", "Coverage %", "percent", { required: true }),
    ],
  },
  {
    key: "RADIANT_BARRIER",
    label: "Radiant barrier",
    group: "Envelope / Shell",
    requiresQuantity: false,
    requiredPaths: ["inputs.coveragePercent", "inputs.installLocation"],
    fields: [
      f("inputs.coveragePercent", "Coverage %", "percent", { required: true }),
      f("inputs.installLocation", "Install location", "select", { options: ["RAFTERS", "DECKING", "OTHER", "UNKNOWN"], required: true }),
    ],
  },
  {
    key: "ATTIC_VENTILATION",
    label: "Attic ventilation",
    group: "Envelope / Shell",
    requiresQuantity: false,
    requiredPaths: ["before.ventType", "after.ventType", "inputs.atticFanPresent"],
    fields: [
      f("before.ventType", "Before vent type", "select", { options: OPT_VENT, required: true }),
      f("after.ventType", "After vent type", "select", { options: OPT_VENT, required: true }),
      f("inputs.atticFanPresent", "Attic fan present", "select", { options: OPT_YES_NO_UNKNOWN, required: true }),
    ],
  },
  {
    key: "ROOF_COLOR_COOL_ROOF",
    label: "Roof color / cool roof",
    group: "Envelope / Shell",
    requiresQuantity: false,
    requiredPaths: ["before.roofColor", "after.roofColor", "inputs.coolRoofRated"],
    fields: [
      f("before.roofColor", "Before roof color", "select", { options: OPT_ROOF_COLOR, required: true }),
      f("after.roofColor", "After roof color", "select", { options: OPT_ROOF_COLOR, required: true }),
      f("inputs.coolRoofRated", "Cool roof rated", "select", { options: OPT_YES_NO_UNKNOWN, required: true }),
    ],
  },
  {
    key: "DUCT_SEALING",
    label: "Duct sealing",
    group: "Envelope / Shell",
    requiresQuantity: false,
    requiredPaths: ["before.ductCondition", "after.ductCondition", "inputs.location"],
    fields: [
      f("before.ductCondition", "Before duct condition", "select", { options: OPT_DUCT_CONDITION, required: true }),
      f("after.ductCondition", "After duct condition", "select", { options: OPT_DUCT_CONDITION, required: true }),
      f("inputs.location", "Location", "select", { options: OPT_LOCATION, required: true }),
    ],
  },
  {
    key: "DUCT_INSULATION",
    label: "Duct insulation",
    group: "Envelope / Shell",
    requiresQuantity: false,
    requiredPaths: ["after.rValue", "inputs.location"],
    fields: [
      f("before.rValue", "Before R-value", "number"),
      f("after.rValue", "After R-value", "number", { required: true }),
      f("inputs.location", "Location", "select", { options: ["ATTIC", "CRAWLSPACE", "UNKNOWN"], required: true }),
      f("inputs.percentCoverage", "Percent coverage", "percent"),
    ],
  },
  {
    key: "DUCT_REPLACEMENT_REROUTE",
    label: "Duct replacement / reroute",
    group: "Envelope / Shell",
    requiresQuantity: false,
    requiredPaths: ["before.ductCondition", "after.ductCondition", "inputs.locationBefore", "inputs.locationAfter"],
    fields: [
      f("before.ductCondition", "Before condition", "select", { options: OPT_DUCT_CONDITION, required: true }),
      f("after.ductCondition", "After condition", "select", { options: OPT_DUCT_CONDITION, required: true }),
      f("inputs.locationBefore", "Location before", "text", { required: true }),
      f("inputs.locationAfter", "Location after", "text", { required: true }),
    ],
  },
  // ---- Group 2: HVAC ----
  {
    key: "HVAC_REPLACEMENT_SEER_UPGRADE",
    label: "HVAC replacement / SEER upgrade",
    group: "HVAC / Comfort Systems",
    requiresQuantity: false,
    requiredPaths: ["before.systemType", "before.heatSource", "after.heatSource", "after.seer", "after.stages"],
    fields: [
      f("before.systemType", "Before system type", "select", { options: OPT_SYSTEM, required: true }),
      f("before.heatSource", "Before heat source", "select", { options: OPT_HEAT_SOURCE, required: true }),
      f("after.heatSource", "After heat source", "select", { options: OPT_HEAT_SOURCE, required: true }),
      f("after.seer", "After SEER", "number", { required: true }),
      f("after.stages", "After stages", "select", { options: OPT_STAGES, required: true }),
      f("inputs.tonnage", "Tonnage", "number"),
      f("after.hspf", "After HSPF", "number"),
    ],
  },
  {
    key: "HEAT_STRIP_TO_HEAT_PUMP_SWAP",
    label: "Heat strip to heat pump swap",
    group: "HVAC / Comfort Systems",
    requiresQuantity: false,
    requiredPaths: ["before.heatSource", "after.heatSource", "after.seer", "inputs.tonnage"],
    fields: [
      f("before.heatSource", "Before heat source", "select", { options: ["HEAT_STRIP", "UNKNOWN"], required: true }),
      f("after.heatSource", "After heat source", "select", { options: ["HEAT_PUMP"] }),
      f("after.seer", "After SEER", "number", { required: true }),
      f("inputs.tonnage", "Tonnage", "number", { required: true }),
    ],
  },
  {
    key: "GAS_FURNACE_TO_HEAT_PUMP_SWAP",
    label: "Gas furnace to heat pump swap",
    group: "HVAC / Comfort Systems",
    requiresQuantity: false,
    requiredPaths: ["before.heatSource", "after.heatSource", "inputs.tonnage"],
    fields: [
      f("before.heatSource", "Before heat source", "select", { options: ["GAS_FURNACE", "UNKNOWN"], required: true }),
      f("after.heatSource", "After heat source", "select", { options: ["HEAT_PUMP"] }),
      f("inputs.tonnage", "Tonnage", "number", { required: true }),
      f("after.seer", "After SEER", "number"),
    ],
  },
  {
    key: "MINI_SPLIT_ADD_OR_REPLACE",
    label: "Mini-split add or replace",
    group: "HVAC / Comfort Systems",
    requiresQuantity: false,
    requiredPaths: ["inputs.zonesCount", "inputs.estimatedCoveragePercent"],
    fields: [
      f("inputs.zonesCount", "Zones count", "number", { required: true }),
      f("inputs.seer", "SEER", "number"),
      f("inputs.estimatedCoveragePercent", "Estimated coverage %", "percent", { required: true }),
      f("inputs.heatPump", "Heat pump", "select", { options: OPT_YES_NO_UNKNOWN }),
    ],
  },
  {
    key: "ZONING_ADD",
    label: "Zoning add",
    group: "HVAC / Comfort Systems",
    requiresQuantity: false,
    requiredPaths: ["inputs.zonesBefore", "inputs.zonesAfter"],
    fields: [
      f("inputs.zonesBefore", "Zones before", "number"),
      f("inputs.zonesAfter", "Zones after", "number", { required: true }),
      f("inputs.roomsAffected", "Rooms affected", "text"),
    ],
  },
  {
    key: "WHOLE_HOUSE_FAN",
    label: "Whole house fan",
    group: "HVAC / Comfort Systems",
    requiresQuantity: false,
    requiredPaths: ["inputs.presentAfter", "inputs.seasonalUse"],
    fields: [
      f("inputs.presentAfter", "Present after", "select", { options: ["YES", "NO"], required: true }),
      f("inputs.seasonalUse", "Seasonal use", "select", { options: ["SPRING_FALL", "SUMMER", "RARE", "UNKNOWN"], required: true }),
    ],
  },
  {
    key: "WHOLE_HOME_DEHUMIDIFIER",
    label: "Whole-home dehumidifier",
    group: "HVAC / Comfort Systems",
    requiresQuantity: false,
    requiredPaths: ["inputs.presentAfter", "inputs.controlStrategy"],
    fields: [
      f("inputs.presentAfter", "Present after", "select", { options: ["YES", "NO"], required: true }),
      f("inputs.controlStrategy", "Control strategy", "select", { options: ["AUTO", "MANUAL", "UNKNOWN"], required: true }),
    ],
  },
  {
    key: "ERV_HRV_VENTILATION",
    label: "ERV / HRV ventilation",
    group: "HVAC / Comfort Systems",
    requiresQuantity: false,
    requiredPaths: ["inputs.presentAfter", "inputs.type"],
    fields: [
      f("inputs.presentAfter", "Present after", "select", { options: ["YES", "NO"], required: true }),
      f("inputs.type", "Type", "select", { options: ["ERV", "HRV", "UNKNOWN"], required: true }),
    ],
  },
  {
    key: "HVAC_MAINTENANCE_FIX",
    label: "HVAC maintenance / fix",
    group: "HVAC / Comfort Systems",
    requiresQuantity: false,
    requiredPaths: ["inputs.issueType", "inputs.severity"],
    fields: [
      f("inputs.issueType", "Issue type", "select", { options: ["REFRIGERANT", "DIRTY_COILS", "DUCT_LEAK", "BROKEN_PART", "OTHER", "UNKNOWN"], required: true }),
      f("inputs.severity", "Severity", "select", { options: OPT_IMPACT, required: true }),
    ],
  },
  {
    key: "THERMOSTAT_DEVICE_INSTALL",
    label: "Thermostat device install",
    group: "HVAC / Comfort Systems",
    requiresQuantity: false,
    requiredPaths: ["after.hasSmartThermostat", "after.brand"],
    fields: [
      f("after.hasSmartThermostat", "Has smart thermostat", "select", { options: ["YES", "NO", "UNKNOWN"], required: true }),
      f("after.brand", "Brand", "select", { options: OPT_THERMOSTAT_BRAND, required: true }),
      f("after.model", "Model", "text"),
    ],
  },
  {
    key: "THERMOSTAT_SETPOINT_SCHEDULE_CHANGE",
    label: "Thermostat setpoint / schedule change",
    group: "HVAC / Comfort Systems",
    requiresQuantity: false,
    requiredPaths: ["inputs.scheduleType"],
    fields: [
      f("inputs.scheduleType", "Schedule type", "select", { options: OPT_SCHEDULE_TYPE, required: true }),
      f("inputs.coolSetpointBefore", "Cool setpoint before", "number"),
      f("inputs.coolSetpointAfter", "Cool setpoint after", "number"),
      f("inputs.heatSetpointBefore", "Heat setpoint before", "number"),
      f("inputs.heatSetpointAfter", "Heat setpoint after", "number"),
    ],
  },
  // ---- Group 3: Water Heating ----
  {
    key: "WATER_HEATER_REPLACEMENT",
    label: "Water heater replacement",
    group: "Water Heating / Hot Water",
    requiresQuantity: false,
    requiredPaths: ["before.type", "after.type"],
    fields: [
      f("before.type", "Before type", "select", { options: OPT_WATER_TYPE, required: true }),
      f("after.type", "After type", "select", { options: OPT_WATER_TYPE, required: true }),
      f("inputs.tankSizeGallons", "Tank size (gal)", "number"),
    ],
  },
  {
    key: "ELECTRIC_TANK_TO_HPWH",
    label: "Electric tank to heat pump water heater",
    group: "Water Heating / Hot Water",
    requiresQuantity: false,
    requiredPaths: ["before.type", "after.type", "inputs.tankSizeGallons", "after.mode"],
    fields: [
      f("before.type", "Before type", "select", { options: ["ELECTRIC_TANK", "UNKNOWN"], required: true }),
      f("after.type", "After type", "select", { options: ["HPWH"] }),
      f("inputs.tankSizeGallons", "Tank size (gal)", "number", { required: true }),
      f("after.mode", "Mode", "select", { options: OPT_HPWH_MODE, required: true }),
    ],
  },
  {
    key: "TANK_TO_TANKLESS",
    label: "Tank to tankless",
    group: "Water Heating / Hot Water",
    requiresQuantity: false,
    requiredPaths: ["before.type", "after.type", "inputs.fuel"],
    fields: [
      f("before.type", "Before type", "select", { options: ["ELECTRIC_TANK", "GAS_TANK", "UNKNOWN"], required: true }),
      f("after.type", "After type", "select", { options: ["TANKLESS"] }),
      f("inputs.fuel", "Fuel", "select", { options: OPT_FUEL, required: true }),
    ],
  },
  {
    key: "RECIRC_PUMP_ADD_REMOVE",
    label: "Recirc pump add/remove",
    group: "Water Heating / Hot Water",
    requiresQuantity: false,
    requiredPaths: ["inputs.presentBefore", "inputs.presentAfter", "inputs.control"],
    fields: [
      f("inputs.presentBefore", "Present before", "select", { options: OPT_YES_NO_UNKNOWN, required: true }),
      f("inputs.presentAfter", "Present after", "select", { options: OPT_YES_NO_UNKNOWN, required: true }),
      f("inputs.control", "Control", "select", { options: ["TIMER", "DEMAND", "ALWAYS_ON", "UNKNOWN"], required: true }),
    ],
  },
  {
    key: "WATER_HEATER_SETPOINT_CHANGE",
    label: "Water heater setpoint change",
    group: "Water Heating / Hot Water",
    requiresQuantity: false,
    requiredPaths: ["inputs.tempFBefore", "inputs.tempFAfter"],
    fields: [
      f("inputs.tempFBefore", "Temp °F before", "number"),
      f("inputs.tempFAfter", "Temp °F after", "number", { required: true }),
    ],
  },
  {
    key: "HOT_WATER_LEAK_FIX",
    label: "Hot water leak fix",
    group: "Water Heating / Hot Water",
    requiresQuantity: false,
    requiredPaths: ["inputs.leakSeverity", "inputs.fixed"],
    fields: [
      f("inputs.leakSeverity", "Leak severity", "select", { options: OPT_IMPACT, required: true }),
      f("inputs.fixed", "Fixed", "select", { options: ["YES"] }),
    ],
  },
  // ---- Group 4: Lighting ----
  {
    key: "LED_LIGHTING_UPGRADE",
    label: "LED lighting upgrade",
    group: "Lighting",
    requiresQuantity: false,
    requiredPaths: ["inputs.percentConverted", "inputs.bulbTypeBefore", "inputs.bulbTypeAfter"],
    fields: [
      f("inputs.percentConverted", "Percent converted", "percent", { required: true }),
      f("inputs.bulbTypeBefore", "Bulb type before", "select", { options: OPT_BULB, required: true }),
      f("inputs.bulbTypeAfter", "Bulb type after", "select", { options: ["LED", "MIXED", "UNKNOWN"], required: true }),
      f("inputs.hoursPerDayEstimate", "Hours/day estimate", "number"),
    ],
  },
  {
    key: "LIGHTING_ADDED_LOAD",
    label: "Lighting added load",
    group: "Lighting",
    requiresQuantity: false,
    requiredPaths: ["inputs.loadType", "inputs.hoursPerDay", "inputs.wattsEstimated"],
    fields: [
      f("inputs.loadType", "Load type", "select", { options: ["LANDSCAPE", "SHOP", "GARAGE", "DECORATIVE", "OTHER", "UNKNOWN"], required: true }),
      f("inputs.hoursPerDay", "Hours/day", "number"),
      f("inputs.wattsEstimated", "Watts estimated", "number"),
    ],
  },
  {
    key: "LIGHTING_AUTOMATION_OCC_SENSORS",
    label: "Lighting automation / occupancy sensors",
    group: "Lighting",
    requiresQuantity: false,
    requiredPaths: ["inputs.automationType", "inputs.coveragePercent"],
    fields: [
      f("inputs.automationType", "Automation type", "select", { options: ["OCC_SENSORS", "TIMERS", "SMART_SWITCHES", "UNKNOWN"], required: true }),
      f("inputs.coveragePercent", "Coverage %", "percent", { required: true }),
    ],
  },
  // ---- Group 5: Major Appliances (abbreviated; same pattern) ----
  {
    key: "REFRIGERATOR_REPLACEMENT",
    label: "Refrigerator replacement",
    group: "Major Appliances",
    requiresQuantity: false,
    requiredPaths: ["before.ageYears", "after.energyStar", "inputs.countAffected"],
    fields: [
      f("before.ageYears", "Before age (years)", "number"),
      f("after.energyStar", "After Energy Star", "select", { options: OPT_YES_NO_UNKNOWN, required: true }),
      f("inputs.countAffected", "Count affected", "number"),
    ],
  },
  {
    key: "SECOND_FRIDGE_FREEZER_ADD_REMOVE",
    label: "Second fridge/freezer add/remove",
    group: "Major Appliances",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.location"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.location", "Location", "select", { options: OPT_LOCATION, required: true }),
    ],
  },
  {
    key: "DISHWASHER_REPLACEMENT",
    label: "Dishwasher replacement",
    group: "Major Appliances",
    requiresQuantity: false,
    requiredPaths: ["inputs.loadsPerWeekBefore", "inputs.loadsPerWeekAfter", "after.energyStar"],
    fields: [
      f("inputs.loadsPerWeekBefore", "Loads/week before", "number"),
      f("inputs.loadsPerWeekAfter", "Loads/week after", "number"),
      f("after.energyStar", "After Energy Star", "select", { options: OPT_YES_NO_UNKNOWN, required: true }),
    ],
  },
  {
    key: "WASHER_REPLACEMENT",
    label: "Washer replacement",
    group: "Major Appliances",
    requiresQuantity: false,
    requiredPaths: ["inputs.loadsPerWeekBefore", "inputs.loadsPerWeekAfter", "after.energyStar"],
    fields: [
      f("inputs.loadsPerWeekBefore", "Loads/week before", "number"),
      f("inputs.loadsPerWeekAfter", "Loads/week after", "number"),
      f("after.energyStar", "After Energy Star", "select", { options: OPT_YES_NO_UNKNOWN, required: true }),
    ],
  },
  {
    key: "DRYER_REPLACEMENT_OR_FUEL_CHANGE",
    label: "Dryer replacement or fuel change",
    group: "Major Appliances",
    requiresQuantity: false,
    requiredPaths: ["before.fuel", "after.fuel", "inputs.loadsPerWeek"],
    fields: [
      f("before.fuel", "Before fuel", "select", { options: OPT_FUEL, required: true }),
      f("after.fuel", "After fuel", "select", { options: OPT_FUEL, required: true }),
      f("inputs.loadsPerWeek", "Loads/week", "number"),
    ],
  },
  {
    key: "OVEN_RANGE_REPLACEMENT_OR_FUEL_CHANGE",
    label: "Oven/range replacement or fuel change",
    group: "Major Appliances",
    requiresQuantity: false,
    requiredPaths: ["before.fuel", "after.fuel", "inputs.cookingFrequency"],
    fields: [
      f("before.fuel", "Before fuel", "select", { options: OPT_FUEL, required: true }),
      f("after.fuel", "After fuel", "select", { options: OPT_FUEL, required: true }),
      f("inputs.cookingFrequency", "Cooking frequency", "select", { options: ["LOW", "MED", "HIGH", "UNKNOWN"], required: true }),
    ],
  },
  {
    key: "MICROWAVE_REPLACEMENT",
    label: "Microwave replacement",
    group: "Major Appliances",
    requiresQuantity: false,
    requiredPaths: ["inputs.usageHoursPerWeek", "after.wattage"],
    fields: [
      f("inputs.usageHoursPerWeek", "Usage hours/week", "number"),
      f("after.wattage", "After wattage", "number"),
    ],
  },
  {
    key: "STANDALONE_FREEZER_ADD_REMOVE",
    label: "Standalone freezer add/remove",
    group: "Major Appliances",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.location"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.location", "Location", "select", { options: OPT_LOCATION, required: true }),
    ],
  },
  {
    key: "WINE_FRIDGE_ADD_REMOVE",
    label: "Wine fridge add/remove",
    group: "Major Appliances",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.location"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.location", "Location", "select", { options: OPT_LOCATION, required: true }),
    ],
  },
  {
    key: "ICE_MAKER_ADD_REMOVE",
    label: "Ice maker add/remove",
    group: "Major Appliances",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.location"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.location", "Location", "select", { options: OPT_LOCATION, required: true }),
    ],
  },
  {
    key: "GARBAGE_DISPOSAL_ADD_REMOVE",
    label: "Garbage disposal add/remove",
    group: "Major Appliances",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.location"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.location", "Location", "select", { options: OPT_LOCATION, required: true }),
    ],
  },
  {
    key: "VENT_HOOD_ADD_REMOVE",
    label: "Vent hood add/remove",
    group: "Major Appliances",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.location"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.location", "Location", "select", { options: OPT_LOCATION, required: true }),
    ],
  },
  // ---- Group 6: EV ----
  {
    key: "EV_PURCHASED_ADD_LOAD",
    label: "EV purchased (add load)",
    group: "EV / Transportation",
    requiresQuantity: false,
    requiredPaths: ["inputs.evCountDelta", "inputs.milesPerDay", "inputs.daysPerWeek", "inputs.chargerType", "inputs.chargeSchedule"],
    fields: [
      f("inputs.evCountDelta", "EV count delta", "number", { required: true }),
      f("inputs.milesPerDay", "Miles/day", "number", { required: true }),
      f("inputs.daysPerWeek", "Days/week (0–7)", "number", { required: true }),
      f("inputs.chargerType", "Charger type", "select", { options: OPT_CHARGER, required: true }),
      f("inputs.chargeSchedule", "Charge schedule", "select", { options: OPT_CHARGE_SCHEDULE, required: true }),
      f("inputs.whPerMile", "Wh/mile", "number"),
    ],
  },
  {
    key: "EV_SOLD_REMOVE_LOAD",
    label: "EV sold (remove load)",
    group: "EV / Transportation",
    requiresQuantity: false,
    requiredPaths: ["inputs.evCountDelta", "inputs.milesPerDay", "inputs.daysPerWeek", "inputs.chargerType", "inputs.chargeSchedule"],
    fields: [
      f("inputs.evCountDelta", "EV count delta", "number", { required: true }),
      f("inputs.milesPerDay", "Miles/day", "number", { required: true }),
      f("inputs.daysPerWeek", "Days/week (0–7)", "number", { required: true }),
      f("inputs.chargerType", "Charger type", "select", { options: OPT_CHARGER, required: true }),
      f("inputs.chargeSchedule", "Charge schedule", "select", { options: OPT_CHARGE_SCHEDULE, required: true }),
    ],
  },
  {
    key: "EV_REPLACED",
    label: "EV replaced",
    group: "EV / Transportation",
    requiresQuantity: false,
    requiredPaths: ["before.milesPerDay", "after.milesPerDay", "inputs.whPerMileBefore", "inputs.whPerMileAfter"],
    fields: [
      f("before.milesPerDay", "Before miles/day", "number"),
      f("after.milesPerDay", "After miles/day", "number", { required: true }),
      f("inputs.whPerMileBefore", "Wh/mile before", "number"),
      f("inputs.whPerMileAfter", "Wh/mile after", "number"),
    ],
  },
  {
    key: "EV_CHARGER_INSTALL_OR_CHANGE",
    label: "EV charger install or change",
    group: "EV / Transportation",
    requiresQuantity: false,
    requiredPaths: ["before.chargerType", "after.chargerType", "inputs.maxKw"],
    fields: [
      f("before.chargerType", "Before charger type", "select", { options: OPT_CHARGER, required: true }),
      f("after.chargerType", "After charger type", "select", { options: OPT_CHARGER, required: true }),
      f("inputs.maxKw", "Max kW", "number"),
    ],
  },
  {
    key: "EV_CHARGING_SCHEDULE_CHANGE",
    label: "EV charging schedule change",
    group: "EV / Transportation",
    requiresQuantity: false,
    requiredPaths: ["before.chargeSchedule", "after.chargeSchedule"],
    fields: [
      f("before.chargeSchedule", "Before schedule", "select", { options: OPT_CHARGE_SCHEDULE, required: true }),
      f("after.chargeSchedule", "After schedule", "select", { options: OPT_CHARGE_SCHEDULE, required: true }),
    ],
  },
  {
    key: "DAILY_MILES_CHANGED",
    label: "Daily miles changed",
    group: "EV / Transportation",
    requiresQuantity: false,
    requiredPaths: ["before.value", "after.value"],
    fields: [
      f("before.value", "Before value", "number", { required: true }),
      f("after.value", "After value", "number", { required: true }),
    ],
  },
  {
    key: "SECOND_EV_ADD_REMOVE",
    label: "Second EV add/remove",
    group: "EV / Transportation",
    requiresQuantity: false,
    requiredPaths: ["inputs.evCountDelta", "inputs.milesPerDay", "inputs.daysPerWeek", "inputs.chargerType", "inputs.chargeSchedule"],
    fields: [
      f("inputs.evCountDelta", "EV count delta", "number", { required: true }),
      f("inputs.milesPerDay", "Miles/day", "number", { required: true }),
      f("inputs.daysPerWeek", "Days/week (0–7)", "number", { required: true }),
      f("inputs.chargerType", "Charger type", "select", { options: OPT_CHARGER, required: true }),
      f("inputs.chargeSchedule", "Charge schedule", "select", { options: OPT_CHARGE_SCHEDULE, required: true }),
    ],
  },
  // ---- Group 7: Pool / Spa (with timeRangeList for schedule) ----
  {
    key: "POOL_PUMP_REPLACEMENT",
    label: "Pool pump replacement",
    group: "Pool / Spa / Outdoor",
    requiresQuantity: false,
    requiredPaths: ["before.pumpType", "after.pumpType", "inputs.summerHoursPerDay"],
    fields: [
      f("before.pumpType", "Before pump type", "select", { options: OPT_PUMP_TYPE, required: true }),
      f("after.pumpType", "After pump type", "select", { options: OPT_PUMP_TYPE, required: true }),
      f("inputs.summerHoursPerDay", "Summer hours/day", "number", { required: true }),
      f("inputs.winterHoursPerDay", "Winter hours/day", "number"),
    ],
  },
  {
    key: "POOL_PUMP_SCHEDULE_CHANGE",
    label: "Pool pump schedule change",
    group: "Pool / Spa / Outdoor",
    requiresQuantity: false,
    requiredPaths: ["inputs.scheduleWindows", "inputs.season"],
    fields: [
      f("inputs.scheduleWindows", "Schedule windows (start–end)", "timeRangeList", { required: true }),
      f("inputs.season", "Season", "select", { options: OPT_SEASON, required: true }),
      f("inputs.daysOfWeek", "Days of week", "multiselect", { options: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] }),
      f("before.hoursPerDay", "Before hours/day", "number"),
      f("after.hoursPerDay", "After hours/day", "number"),
    ],
  },
  {
    key: "POOL_HEATER_ADD_REMOVE",
    label: "Pool heater add/remove",
    group: "Pool / Spa / Outdoor",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.heaterType", "inputs.usageFrequency"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.heaterType", "Heater type", "select", { options: ["ELECTRIC_HEAT_PUMP", "GAS", "RESISTIVE", "UNKNOWN"], required: true }),
      f("inputs.usageFrequency", "Usage frequency", "select", { options: ["LOW", "MED", "HIGH", "UNKNOWN"], required: true }),
    ],
  },
  {
    key: "HOT_TUB_SPA_ADD_REMOVE",
    label: "Hot tub / spa add/remove",
    group: "Pool / Spa / Outdoor",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.hoursPerDay", "inputs.wattsEstimated"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.hoursPerDay", "Hours/day", "number"),
      f("inputs.wattsEstimated", "Watts estimated", "number"),
    ],
  },
  {
    key: "WATER_FEATURE_PUMPS_ADD_REMOVE",
    label: "Water feature pumps add/remove",
    group: "Pool / Spa / Outdoor",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.hoursPerDay", "inputs.wattsEstimated"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.hoursPerDay", "Hours/day", "number"),
      f("inputs.wattsEstimated", "Watts estimated", "number"),
    ],
  },
  {
    key: "POOL_LIGHTING_SCHEDULE",
    label: "Pool lighting schedule",
    group: "Pool / Spa / Outdoor",
    requiresQuantity: false,
    requiredPaths: ["inputs.scheduleWindows"],
    fields: [
      f("inputs.scheduleWindows", "Schedule windows (start–end)", "timeRangeList", { required: true }),
      f("before.hoursPerDay", "Before hours/day", "number"),
      f("after.hoursPerDay", "After hours/day", "number"),
      f("inputs.daysOfWeek", "Days of week", "multiselect", { options: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] }),
    ],
  },
  // ---- Group 8: Plug loads (abbreviated) ----
  {
    key: "SPACE_HEATER_ADD_REMOVE",
    label: "Space heater add/remove",
    group: "Plug Loads / Special Equipment",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.wattsEstimated", "inputs.hoursPerDay", "inputs.daysPerWeek"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.wattsEstimated", "Watts estimated", "number"),
      f("inputs.hoursPerDay", "Hours/day", "number"),
      f("inputs.daysPerWeek", "Days/week (0–7)", "number"),
    ],
  },
  {
    key: "WINDOW_AC_ADD_REMOVE",
    label: "Window AC add/remove",
    group: "Plug Loads / Special Equipment",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.wattsEstimated", "inputs.hoursPerDay", "inputs.daysPerWeek"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.wattsEstimated", "Watts estimated", "number"),
      f("inputs.hoursPerDay", "Hours/day", "number"),
      f("inputs.daysPerWeek", "Days/week (0–7)", "number"),
    ],
  },
  {
    key: "PORTABLE_DEHUMIDIFIER_ADD_REMOVE",
    label: "Portable dehumidifier add/remove",
    group: "Plug Loads / Special Equipment",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.wattsEstimated", "inputs.hoursPerDay", "inputs.daysPerWeek"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.wattsEstimated", "Watts estimated", "number"),
      f("inputs.hoursPerDay", "Hours/day", "number"),
      f("inputs.daysPerWeek", "Days/week (0–7)", "number"),
    ],
  },
  {
    key: "HOME_SERVER_HOME_LAB_ADD_REMOVE",
    label: "Home server / home lab add/remove",
    group: "Plug Loads / Special Equipment",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.averageWatts", "inputs.hoursPerDay"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.averageWatts", "Average watts", "number", { required: true }),
      f("inputs.hoursPerDay", "Hours/day", "number", { required: true }),
    ],
  },
  {
    key: "AQUARIUM_SYSTEM_ADD_REMOVE",
    label: "Aquarium system add/remove",
    group: "Plug Loads / Special Equipment",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.wattsEstimated", "inputs.hoursPerDay", "inputs.daysPerWeek"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.wattsEstimated", "Watts estimated", "number"),
      f("inputs.hoursPerDay", "Hours/day", "number"),
      f("inputs.daysPerWeek", "Days/week (0–7)", "number"),
    ],
  },
  {
    key: "WORKSHOP_EQUIPMENT_ADD_REMOVE",
    label: "Workshop equipment add/remove",
    group: "Plug Loads / Special Equipment",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.wattsEstimated", "inputs.hoursPerDay", "inputs.daysPerWeek"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.wattsEstimated", "Watts estimated", "number"),
      f("inputs.hoursPerDay", "Hours/day", "number"),
      f("inputs.daysPerWeek", "Days/week (0–7)", "number"),
    ],
  },
  {
    key: "HIGH_COMPUTE_MINING_ADD_REMOVE",
    label: "High compute / mining add/remove",
    group: "Plug Loads / Special Equipment",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.averageWatts", "inputs.hoursPerDay"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.averageWatts", "Average watts", "number", { required: true }),
      f("inputs.hoursPerDay", "Hours/day", "number", { required: true }),
    ],
  },
  {
    key: "IRRIGATION_PUMP_ADD_REMOVE",
    label: "Irrigation pump add/remove",
    group: "Plug Loads / Special Equipment",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.hoursPerDay", "inputs.seasonal"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.hp", "HP", "number"),
      f("inputs.hoursPerDay", "Hours/day", "number"),
      f("inputs.seasonal", "Seasonal", "select", { options: ["SUMMER", "YEAR_ROUND", "UNKNOWN"], required: true }),
    ],
  },
  {
    key: "WELL_PUMP_ADD_REMOVE",
    label: "Well pump add/remove",
    group: "Plug Loads / Special Equipment",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.hoursPerDay", "inputs.seasonal"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.hp", "HP", "number"),
      f("inputs.hoursPerDay", "Hours/day", "number"),
      f("inputs.seasonal", "Seasonal", "select", { options: OPT_SEASON, required: true }),
    ],
  },
  {
    key: "SUMP_PUMP_ADD_REMOVE",
    label: "Sump pump add/remove",
    group: "Plug Loads / Special Equipment",
    requiresQuantity: false,
    requiredPaths: ["inputs.action", "inputs.hoursPerDay", "inputs.seasonal"],
    fields: [
      f("inputs.action", "Action", "select", { options: OPT_ACTION, required: true }),
      f("inputs.hoursPerDay", "Hours/day", "number"),
      f("inputs.seasonal", "Seasonal", "select", { options: OPT_SEASON, required: true }),
    ],
  },
  // ---- Group 9: Occupancy ----
  {
    key: "OCCUPANTS_MOVED_IN_OUT",
    label: "Occupants moved in/out",
    group: "Occupancy / Behavior",
    requiresQuantity: false,
    requiredPaths: ["inputs.occupantsTotalBefore", "inputs.occupantsTotalAfter", "inputs.homeAllDayBefore", "inputs.homeAllDayAfter"],
    fields: [
      f("inputs.occupantsTotalBefore", "Occupants before", "number", { required: true }),
      f("inputs.occupantsTotalAfter", "Occupants after", "number", { required: true }),
      f("inputs.homeAllDayBefore", "Home all day before", "number", { required: true }),
      f("inputs.homeAllDayAfter", "Home all day after", "number", { required: true }),
    ],
  },
  {
    key: "WORK_FROM_HOME_CHANGE",
    label: "Work from home change",
    group: "Occupancy / Behavior",
    requiresQuantity: false,
    requiredPaths: ["inputs.workFromHomeBefore", "inputs.workFromHomeAfter", "inputs.daysPerWeek"],
    fields: [
      f("inputs.workFromHomeBefore", "Work from home before", "number", { required: true }),
      f("inputs.workFromHomeAfter", "Work from home after", "number", { required: true }),
      f("inputs.daysPerWeek", "Days/week (0–7)", "number", { required: true }),
    ],
  },
  {
    key: "SCHOOL_SCHEDULE_CHANGE",
    label: "School schedule change",
    group: "Occupancy / Behavior",
    requiresQuantity: false,
    requiredPaths: ["inputs.schoolHomeBefore", "inputs.schoolHomeAfter"],
    fields: [
      f("inputs.schoolHomeBefore", "School home before", "number", { required: true }),
      f("inputs.schoolHomeAfter", "School home after", "number", { required: true }),
    ],
  },
  {
    key: "NEW_BABY_HOUSEHOLD_CHANGE",
    label: "New baby / household change",
    group: "Occupancy / Behavior",
    requiresQuantity: false,
    requiredPaths: ["inputs.occupancyImpact", "inputs.hoursHomeIncrease"],
    fields: [
      f("inputs.occupancyImpact", "Occupancy impact", "select", { options: OPT_IMPACT, required: true }),
      f("inputs.hoursHomeIncrease", "Hours home increase", "select", { options: OPT_IMPACT, required: true }),
    ],
  },
  {
    key: "CAREGIVER_ELDER_MOVED_IN",
    label: "Caregiver / elder moved in",
    group: "Occupancy / Behavior",
    requiresQuantity: false,
    requiredPaths: ["inputs.occupancyImpact", "inputs.hoursHomeIncrease"],
    fields: [
      f("inputs.occupancyImpact", "Occupancy impact", "select", { options: OPT_IMPACT, required: true }),
      f("inputs.hoursHomeIncrease", "Hours home increase", "select", { options: OPT_IMPACT, required: true }),
    ],
  },
  {
    key: "AIRBNB_RENTAL_MODE",
    label: "Airbnb / rental mode",
    group: "Occupancy / Behavior",
    requiresQuantity: false,
    requiredPaths: ["inputs.mode", "inputs.occupancyRatePercent"],
    fields: [
      f("inputs.mode", "Mode", "select", { options: ["ON", "OFF"], required: true }),
      f("inputs.occupancyRatePercent", "Occupancy rate %", "percent"),
    ],
  },
  {
    key: "PETS_ADDED_REMOVED",
    label: "Pets added/removed",
    group: "Occupancy / Behavior",
    requiresQuantity: false,
    requiredPaths: ["inputs.petCountDelta", "inputs.petType"],
    fields: [
      f("inputs.petCountDelta", "Pet count delta", "number", { required: true }),
      f("inputs.petType", "Pet type", "select", { options: ["DOG", "CAT", "OTHER", "UNKNOWN"], required: true }),
    ],
  },
  {
    key: "BEHAVIOR_TIME_SHIFT_LAUNDRY_DISHWASHER",
    label: "Behavior time shift (laundry/dishwasher)",
    group: "Occupancy / Behavior",
    requiresQuantity: false,
    requiredPaths: ["inputs.shiftType", "inputs.loadsPerWeekAffected"],
    fields: [
      f("inputs.shiftType", "Shift type", "select", { options: ["TO_NIGHTS", "TO_DAYS", "TO_WEEKENDS", "UNKNOWN"], required: true }),
      f("inputs.loadsPerWeekAffected", "Loads/week affected", "number"),
    ],
  },
  {
    key: "COOKING_FREQUENCY_CHANGE",
    label: "Cooking frequency change",
    group: "Occupancy / Behavior",
    requiresQuantity: false,
    requiredPaths: ["inputs.frequencyBefore", "inputs.frequencyAfter"],
    fields: [
      f("inputs.frequencyBefore", "Frequency before", "select", { options: ["LOW", "MED", "HIGH", "UNKNOWN"], required: true }),
      f("inputs.frequencyAfter", "Frequency after", "select", { options: ["LOW", "MED", "HIGH", "UNKNOWN"], required: true }),
    ],
  },
  // ---- Group 10: Solar / Battery ----
  {
    key: "SOLAR_INSTALLED",
    label: "Solar installed",
    group: "Solar / Battery / Export",
    requiresQuantity: false,
    requiredPaths: ["inputs.solar.kwDc", "inputs.solar.productionSource"],
    fields: [
      f("inputs.solar.kwDc", "Solar kW DC", "number", { required: true }),
      f("inputs.solar.hasInverterType", "Inverter type", "text"),
      f("inputs.solar.productionSource", "Production source", "select", { options: ["SOLARGRAF", "UTILITY_PORTAL", "ESTIMATE", "UNKNOWN"], required: true }),
    ],
  },
  {
    key: "SOLAR_REMOVED",
    label: "Solar removed",
    group: "Solar / Battery / Export",
    requiresQuantity: false,
    requiredPaths: ["inputs.solar.kwDc", "inputs.solar.productionSource"],
    fields: [
      f("inputs.solar.kwDc", "Solar kW DC (removed)", "number"),
      f("inputs.solar.productionSource", "Production source", "select", { options: ["SOLARGRAF", "UTILITY_PORTAL", "ESTIMATE", "UNKNOWN"] }),
    ],
  },
  {
    key: "SOLAR_EXPANSION_ADD_PANELS",
    label: "Solar expansion / add panels",
    group: "Solar / Battery / Export",
    requiresQuantity: false,
    requiredPaths: ["inputs.solar.kwDc", "inputs.solar.productionSource"],
    fields: [
      f("inputs.solar.kwDc", "Added kW DC", "number", { required: true }),
      f("inputs.solar.productionSource", "Production source", "select", { options: ["SOLARGRAF", "UTILITY_PORTAL", "ESTIMATE", "UNKNOWN"], required: true }),
    ],
  },
  {
    key: "BATTERY_INSTALLED",
    label: "Battery installed",
    group: "Solar / Battery / Export",
    requiresQuantity: false,
    requiredPaths: ["inputs.battery.kwhUsable", "inputs.battery.model"],
    fields: [
      f("inputs.battery.kwhUsable", "Battery kWh usable", "number", { required: true }),
      f("inputs.battery.model", "Battery model", "text", { required: true }),
      f("inputs.battery.mode", "Battery mode", "select", { options: ["BACKUP_ONLY", "SELF_CONSUMPTION", "TOU_ARBITRAGE", "UNKNOWN"] }),
    ],
  },
  {
    key: "BATTERY_REMOVED",
    label: "Battery removed",
    group: "Solar / Battery / Export",
    requiresQuantity: false,
    requiredPaths: ["inputs.battery.kwhUsable", "inputs.battery.model"],
    fields: [
      f("inputs.battery.kwhUsable", "Battery kWh (removed)", "number"),
      f("inputs.battery.model", "Battery model", "text"),
    ],
  },
  {
    key: "BATTERY_MODE_CHANGE",
    label: "Battery mode change",
    group: "Solar / Battery / Export",
    requiresQuantity: false,
    requiredPaths: ["before.mode", "after.mode"],
    fields: [
      f("before.mode", "Before mode", "select", { options: ["BACKUP_ONLY", "SELF_CONSUMPTION", "TOU_ARBITRAGE", "UNKNOWN"], required: true }),
      f("after.mode", "After mode", "select", { options: ["BACKUP_ONLY", "SELF_CONSUMPTION", "TOU_ARBITRAGE", "UNKNOWN"], required: true }),
    ],
  },
  {
    key: "EXPORT_PLAN_TYPE_CHANGE",
    label: "Export plan type change",
    group: "Solar / Battery / Export",
    requiresQuantity: false,
    requiredPaths: ["inputs.export.planType", "inputs.export.creditRateType", "inputs.delivery.nonBypassable"],
    fields: [
      f("inputs.export.planType", "Export plan type", "select", { options: OPT_EXPORT_PLAN, required: true }),
      f("inputs.export.creditRateType", "Credit rate type", "select", { options: OPT_CREDIT_RATE, required: true }),
      f("inputs.delivery.nonBypassable", "Non-bypassable delivery", "select", { options: OPT_YES_NO_UNKNOWN, required: true }),
    ],
  },
  {
    key: "TDSP_REGION_DELIVERY_CHARGES_CONTEXT",
    label: "TDSP region / delivery charges context",
    group: "Solar / Battery / Export",
    requiresQuantity: false,
    requiredPaths: ["inputs.tdspRegion", "inputs.state"],
    fields: [
      f("inputs.tdspRegion", "TDSP region", "select", { options: OPT_TDSP, required: true }),
      f("inputs.state", "State", "text", { required: true }),
    ],
  },
  // ---- Group 11: Remodel ----
  {
    key: "SQUARE_FOOTAGE_ADDITION_REMODEL",
    label: "Square footage addition / remodel",
    group: "Remodel / Structural",
    requiresQuantity: false,
    requiredPaths: ["before.conditionedSqft", "after.conditionedSqft"],
    fields: [
      f("before.conditionedSqft", "Before conditioned sqft", "number"),
      f("after.conditionedSqft", "After conditioned sqft", "number", { required: true }),
      f("inputs.addedSqft", "Added sqft", "number"),
      f("inputs.hvacChanged", "HVAC changed", "select", { options: OPT_YES_NO_UNKNOWN }),
    ],
  },
  {
    key: "MAJOR_REMODEL_USAGE_SHIFT",
    label: "Major remodel usage shift",
    group: "Remodel / Structural",
    requiresQuantity: false,
    requiredPaths: ["inputs.remodelType", "inputs.expectedImpact"],
    fields: [
      f("inputs.remodelType", "Remodel type", "select", { options: ["KITCHEN", "BATH", "WHOLE_HOME", "OTHER", "UNKNOWN"], required: true }),
      f("inputs.expectedImpact", "Expected impact", "select", { options: OPT_IMPACT, required: true }),
    ],
  },
];

// ---------------------------------------------------------------------------
// Lookup and backward-compat
// ---------------------------------------------------------------------------
const TEMPLATE_BY_KEY = new Map<string, UpgradeTemplate>();
for (const t of UPGRADE_TEMPLATES) {
  TEMPLATE_BY_KEY.set(t.key, t);
}

export function getTemplateByKey(key: string): UpgradeTemplate | null {
  return TEMPLATE_BY_KEY.get(String(key)) ?? null;
}

export function isAllowedUpgradeType(key: string): boolean {
  return TEMPLATE_BY_KEY.has(String(key));
}

export function isAllowedChangeType(key: string): key is ChangeType {
  return (UPGRADE_CHANGE_TYPES as readonly string[]).includes(String(key));
}

/** @deprecated Use UPGRADE_CHANGE_TYPES */
export const CHANGE_TYPES = UPGRADE_CHANGE_TYPES;
export { UPGRADE_CHANGE_TYPES };

/** Grouped for UI dropdown; derived from templates. */
export type UpgradeCatalogEntry = { key: string; label: string; units?: string };
export type UpgradeCatalogGroup = { label: string; types: UpgradeCatalogEntry[] };

export const UPGRADE_CATALOG_GROUPS: UpgradeCatalogGroup[] = (() => {
  const byGroup = new Map<string, UpgradeCatalogEntry[]>();
  for (const t of UPGRADE_TEMPLATES) {
    let list = byGroup.get(t.group);
    if (!list) {
      list = [];
      byGroup.set(t.group, list);
    }
    list.push({
      key: t.key,
      label: t.label,
      units: t.defaultUnits,
    });
  }
  const order = [
    "Envelope / Shell",
    "HVAC / Comfort Systems",
    "Water Heating / Hot Water",
    "Lighting",
    "Major Appliances",
    "EV / Transportation",
    "Pool / Spa / Outdoor",
    "Plug Loads / Special Equipment",
    "Occupancy / Behavior",
    "Solar / Battery / Export",
    "Remodel / Structural",
  ];
  return order.map((label) => ({ label, types: byGroup.get(label) ?? [] }));
})();

export const isUpgradeType = isAllowedUpgradeType;
export type { ChangeType, UpgradeTemplate, FieldDescriptor };
export { UPGRADE_TEMPLATES };
