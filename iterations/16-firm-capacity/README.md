# Largest-unit-loss arithmetic

Direct external imports from the pinned `engine/firm-capacity.js` at `d9cd18b0e2034325814924e6e4a0e958014f2748`; no copied formula implementation. `firmCapacityMva` returns installed minus largest stated rating. `assessAgainstFirm` compares positive stated demand. Inputs and chart are synthetic, not an actual site or certified single-line diagram. No MW/MVA conversion is silently applied.

Example `[30,30]MVA`,42MVA demand: installed60, largest30, remainder30, shortfall12, utilisation140% of remainder and70% of installed. Unequal `[90,30]`,42: largest loss leaves30; losing the smaller instead would leave90. The source's broader narrative 'only while nothing is out' is deliberately not repeated. This view describes only the arithmetic and its supplied values.

One stated30MVA unit leaves0. Source assessment returns Infinity for positive demand/zero firm. The JSON record explicitly tags that value `{kind:'nonfinite',value:'Infinity',reason:...}` rather than silently serializing null; UI says no finite percentage. The other result fields remain finite. This is a legitimate edge case, not silently refused as malformed input.

Interface policy: dense one-to-six-unit array, each0.001–1000MVA; positive demand up to5000MVA; unexpected nonfinite results refused. Source positive/type errors remain visible. Sparse arrays are explicitly rejected because the source's forEach input checker skips holes. One largest unit is hatched and excluded from the remainder bar; first equal-largest index is a drawing tie-break only. The fade is not an outage simulation or a claim about physical supply.

No spare capacity, connection availability, cyclic/emergency rating or security compliance is computed. The source proof is a known static caller at the pin; other repositories are not exhaustively audited. RUN and CODE are real actions; unmapped handoffs explain what identity is missing, and SPIDER opens an overview with no invented selected node. Browser and native agent-tool evidence is recorded separately.
