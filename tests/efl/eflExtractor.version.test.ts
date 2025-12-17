import { describe, expect, test } from "vitest";

import { extractEflVersionCodeFromText } from "@/lib/efl/eflExtractor";

describe("eflExtractor - EFL Version code extraction", () => {
  test("extracts full footer code on the same line", () => {
    const text = `
      EFL Version:                                      EFL_ONCOR_ELEC_LS12+_20251215_ENGLISH
    `;
    expect(extractEflVersionCodeFromText(text)).toBe("EFL_ONCOR_ELEC_LS12+_20251215_ENGLISH");
  });

  test("stitches wrapped footer code split across lines (ENGL + ISH)", () => {
    const text = `
      EFL Version:
      EFL_ONCOR_ELEC_LS12+_20251215_ENGL
      ISH
    `;
    expect(extractEflVersionCodeFromText(text)).toBe("EFL_ONCOR_ELEC_LS12+_20251215_ENGLISH");
  });

  test("stitches wrapped footer code split across lines (date digit + language suffix)", () => {
    const text = `
      EFL Version:
      EFL_ONCOR_ELEC_GXAECOSVRPLS24_2025121
      5_ENGLISH
    `;
    expect(extractEflVersionCodeFromText(text)).toBe(
      "EFL_ONCOR_ELEC_GXAECOSVRPLS24_20251215_ENGLISH",
    );
  });

  test("stitches wrapped footer code when value is on the same EFL Version: line (date digit + language suffix)", () => {
    const text = `
      EFL Version: EFL_ONCOR_ELEC_GXAECOSVRADV12_2025121
      5_ENGLISH
    `;
    expect(extractEflVersionCodeFromText(text)).toBe(
      "EFL_ONCOR_ELEC_GXAECOSVRADV12_20251215_ENGLISH",
    );
  });

  test("stitches wrapped footer code split across lines (underscore-prefixed language suffix)", () => {
    const text = `
      EFL Version:
      EFL_ONCOR_ELEC_GXAECOSVRPR24_20251215
      _ENGLISH
    `;
    expect(extractEflVersionCodeFromText(text)).toBe(
      "EFL_ONCOR_ELEC_GXAECOSVRPR24_20251215_ENGLISH",
    );
  });

  test("stitches fallback EFL_* token when trailing language suffix is on the next line (ENGL + ISH)", () => {
    const text = `
      ... footer stuff ...
      EFL_ONCOR_ELEC_FSVRVAL12_20251215_ENGL
      ISH
    `;
    expect(extractEflVersionCodeFromText(text)).toBe(
      "EFL_ONCOR_ELEC_FSVRVAL12_20251215_ENGLISH",
    );
  });

  test("does not return junk fragments like ENGLISH when an EFL_* token exists nearby", () => {
    const text = `
      EFL Version:
      ENGLISH
      EFL_ONCOR_ELEC_ABC12_20251215_ENGLISH
    `;
    expect(extractEflVersionCodeFromText(text)).toBe("EFL_ONCOR_ELEC_ABC12_20251215_ENGLISH");
  });

  test("returns generic codes like 5_ENGLISH when no stronger EFL_* token is present", () => {
    const text = `
      EFL Version:
      5_ENGLISH
    `;
    // Fail-closed: treat non-unique language fragments as missing so we queue for review
    // rather than risk template identity collisions.
    expect(extractEflVersionCodeFromText(text)).toBeNull();
  });

  test("extracts OhmConnect-style footer 'EFL Ref #' identifiers", () => {
    const text = `
      PUCT Certificate No. 10280   TX.OhmConnect.com   EFL Ref # TexasConnect 12 20251208E V1
    `;
    expect(extractEflVersionCodeFromText(text)).toBe("TexasConnect 12 20251208E V1");
  });

  test("stitches Chariot-style 'Ver. #' plan-family label with following underscore code", () => {
    const text = `
      Ver. #: GreenVolt
      PUCT Certificate # 10260                                                                                         24_ONC_U_1220_2995_150_10162025
    `;
    expect(extractEflVersionCodeFromText(text)).toBe(
      "GreenVolt 24_ONC_U_1220_2995_150_10162025",
    );
  });

  test("extracts numeric date-like footer ids when they appear near REP context (Payless-style)", () => {
    const text = `
      Young Energy, LLC DBA Payless Power, REP# 10110                              202512074
      Customer Service: Toll Free 1-888-963-9363
    `;
    expect(extractEflVersionCodeFromText(text)).toBe("202512074");
  });
});


