/**
 * One Path re-exports the canonical user-site weather sensitivity owner.
 * Do not fork scoring logic here — user Usage and One Path baseline must stay aligned.
 */
export {
  buildWeatherEfficiencyDerivedInput,
  buildWeatherEfficiencyDerivedInput as buildOnePathWeatherEfficiencyDerivedInput,
  resolveSharedWeatherSensitivityEnvelope,
  resolveSharedWeatherSensitivityEnvelope as resolveOnePathWeatherSensitivityEnvelope,
  type WeatherEfficiencyDerivedInput,
  type WeatherSensitivityEnvelope,
  type WeatherSensitivityScore,
} from "@/modules/weatherSensitivity/shared";
