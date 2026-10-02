import { SUPPORTED_LOCALES } from "../shared/locale";
import { IMAGE_STUDIO_LOCALE_CATALOGS } from "../studio/i18nCatalogs";

// Issue #165: every Image Studio text catalog must translate the same key set into every
// supported locale. This is also enforced at compile time (each catalog is typed as
// Record<Locale, Shape>), but this test gives a fast, readable failure independent of tsc.
describe("Image Studio locale catalog completeness", () => {
  it.each(Object.entries(IMAGE_STUDIO_LOCALE_CATALOGS))("keeps every locale's key set aligned with ja in %s", (_name, catalog) => {
    const reference = Object.keys(catalog.ja).sort();
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(catalog[locale]).sort()).toEqual(reference);
    }
  });
});
