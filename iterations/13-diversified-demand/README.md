# Group demand lab

An explicit-input illustration, not a network design. Open index.html through an HTTP server. Runtime arithmetic is imported directly from `Ventusltd/ventus-grid-engine` at `d9cd18b0e2034325814924e6e4a0e958014f2748`, `engine/diversified-demand.js`, using its pinned jsDelivr URL. There is no copied implementation and no fallback arithmetic. Network/source unavailability removes the calculation.

`diversifiedDemandKw` supplies aggregate group kW, not per-unit ADMD. `impliedCoincidence` supplies a dimensionless factor from a supplied group peak. Starting values100 units,7kW,0.3 are a synthetic assumption giving210kW against700kW unrestricted; no factor is inferred from the population size. Inverse starting210kW is also synthetic, not a verified measurement. Group and unrestricted bars share a scale normalized to that same group's unrestricted total. Bar interpolation is a visual transition, not simulated time.

The pinned module's own proof is a known static caller; cross-repository callers were not exhaustively audited. No physical grid asset or next connection is established. A single-line diagram could use the quantity as an illustrative load annotation only. No capacity, security, protection, forecast, energy or average-power result is inferred.

Interface policy adds bounds of10,000,000 units,1,000kW per unit, a safe integer count and finite consistent outputs. The engine retains its own positive/range/type refusals. Empty fields stay missing rather than becoming zero. Invalid input clears all visible prior results and disables download. The four module-declared exclusions are displayed with their source attribution, not presented as separately validated claims.

No private state, local paths, account details, arbitrary code evaluation, telemetry, persistent storage or network writes. JSON export contains only the current illustrative inputs/result and public source provenance. Native optional agent controls, if available, use the same validated calculation path; ordinary controls do not require them.

Verification evidence is recorded separately. Desktop/phone viewport emulation is not a physical device test. The100kW review threshold in the footer is a project policy, not a claim that one universal legal threshold applies everywhere.
