export type PrefillValue<T> = { value: T | null; source: "PREFILL" | "DEFAULT" | "UNKNOWN" };

export type HomePrefill = {
  homeStyle?: PrefillValue<string>;
  insulationType?: PrefillValue<string>;
  windowType?: PrefillValue<string>;
  foundation?: PrefillValue<string>;
  squareFeet?: PrefillValue<number>;
  stories?: PrefillValue<number>;
  homeAge?: PrefillValue<number>;
  hasPool?: PrefillValue<boolean>;
  summerTemp?: PrefillValue<number>;
  winterTemp?: PrefillValue<number>;
};

export type HomeDetailsFormState = {
  homeAge: number | "";
  homeStyle: string;
  squareFeet: number | "";
  stories: number | "";
  insulationType: string;
  windowType: string;
  foundation: string;
  ledLights: boolean;
  smartThermostat: boolean;
  summerTemp: number | "";
  winterTemp: number | "";
  occupantsWork: number | "";
  occupantsSchool: number | "";
  occupantsHomeAllDay: number | "";
  fuelConfiguration: string;
  hasPool?: boolean;
};

const DEFAULT_SUMMER_TEMP = 73;
const DEFAULT_WINTER_TEMP = 70;

export function mergePrefillIntoHomeDetailsState(state: HomeDetailsFormState, prefill: HomePrefill): HomeDetailsFormState {
  const next = { ...state };
  if (next.homeAge === "" && prefill?.homeAge?.value != null) next.homeAge = prefill.homeAge.value;
  if (!next.homeStyle && prefill?.homeStyle?.value) next.homeStyle = prefill.homeStyle.value;
  if (next.squareFeet === "" && prefill?.squareFeet?.value != null) next.squareFeet = prefill.squareFeet.value;
  if (next.stories === "" && prefill?.stories?.value != null) next.stories = prefill.stories.value;
  if (!next.insulationType && prefill?.insulationType?.value) next.insulationType = prefill.insulationType.value;
  if (!next.windowType && prefill?.windowType?.value) next.windowType = prefill.windowType.value;
  if (!next.foundation && prefill?.foundation?.value) next.foundation = prefill.foundation.value;
  if (next.hasPool === false && prefill?.hasPool?.value === true) {
    next.hasPool = true;
  }
  if (
    (next.summerTemp === "" || next.summerTemp === DEFAULT_SUMMER_TEMP) &&
    prefill?.summerTemp?.value != null
  ) {
    next.summerTemp = prefill.summerTemp.value;
  }
  if (
    (next.winterTemp === "" || next.winterTemp === DEFAULT_WINTER_TEMP) &&
    prefill?.winterTemp?.value != null
  ) {
    next.winterTemp = prefill.winterTemp.value;
  }
  return next;
}

