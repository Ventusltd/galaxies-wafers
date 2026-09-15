# Verification history

Application source: `c7cb9bfaa165cb7a453e14c087f4a71296c10f1a`.

- Local model and full geometry integrity suite:10tests passed; all201files/47,236features were checked. This is not simultaneous browser-render coverage.
- Pages run35010925304 succeeded for that commit.
- Hosted browser run35010927352 **failed**:1/4cases passed. All four observed no page/console errors or failed network requests up to their stopping points. The two phone cases stopped at an absolute mouse click below the viewport, before inspecting a key; Chromium desktop asserted the row count before the asynchronous details-toggle event populated it. WebKit desktop completed the whole check, including export and tampered-catalogue refusal.
- The test driver was corrected to use a locator-relative, automatically scrolled canvas click and to wait explicitly for table population. Application, geometry, palette and style-model bytes are unchanged by this correction. The failed run remains part of the record; a corrected test file is not itself a passing rerun.

Optional WebMCP hooks are feature-detected, but no supported native validation context was available in this receipt. They are not claimed verified. Headless WebKit is not a physical iPhone or iOS memory-pressure test.
