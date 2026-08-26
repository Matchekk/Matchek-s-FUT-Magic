# Third-party notices

FUT Magic, formerly GrindPilot FC26, is a modified derivative of AutoPilot-SBC. The complete work
is licensed under GPL-3.0-only; see `LICENSE`. Changes are documented by date
in `CHANGELOG.md`. Corresponding source is available at
https://github.com/Matchekk/Matchek-s-FUT-Magic.

## Reviewed upstreams and actual use

| Repository / reviewed snapshot | Detected license | GrindPilot use | Reuse classification |
|---|---|---|---|
| [icysymmetra/AutoPilot-SBC](https://github.com/icysymmetra/AutoPilot-SBC/tree/ebf5d1e90f13329841896d8be227b3d55dd28c3b) | GNU GPL v3.0 (`GPL-3.0-only`) | Canonical MV3 shell, EA bridge, browser solver, chemistry/compiler and existing solve/multi/set/sequence UI and filters | **Copied and adapted.** GrindPilot remains GPL-3.0-only. |
| [titiroMonkey/Auto-SBC](https://github.com/titiroMonkey/Auto-SBC/tree/98279901aab056dd1189df763b750ea86095e3fb) | MIT; upstream notice has no named copyright line | Pack/reward, unassigned, duplicate/Storage and cost-policy behavior; CP-SAT concepts | **Independently reimplemented from inspected behavior.** No Python backend or giant userscript copied. The MIT notice below is retained conservatively for the existing player-value-policy adaptation. |
| [Jijoaj/sbc-repeater](https://github.com/Jijoaj/sbc-repeater/tree/25d5d4b10a51d444732fc9f54a1fa16f7d74503b) | MIT, Copyright (c) 2026 Jijo | DOM settle, submit/reward verification, bounded retry and re-entry behavior | **Independently reimplemented.** No source copied and no Paletools dependency. |
| [tomolom/fut-debug-overlay](https://github.com/tomolom/fut-debug-overlay/tree/e3e3f1cf0514972186aeba496f8570bdba80695f) | Conflicting metadata: root MIT © 2026 tomolom; package says ISC | Optional class discovery, health snapshots/diffs and bounded diagnostics | **Ideas only.** No source copied; metadata conflict avoided. |
| [Regista6/EA-FC-Automated-SBC-Solving](https://github.com/Regista6/EA-FC-Automated-SBC-Solving/tree/b81c71f992d82a3543050e1fb96c95166f3a6c05) | MIT, Copyright (c) 2023 watchdogs132 | Constraint/objective and regression/benchmark reference | **Study and independently authored tests/models only.** |
| [bartlomiej-niemiec/eafc-sbc-solver](https://github.com/bartlomiej-niemiec/eafc-sbc-solver/tree/8d7a2d08cbc54e7ab20915d33901f714239e6b94) | MIT, Copyright (c) 2024 bartlomiej-niemiec | Rating, chemistry and constraint negative-test reference | **Study only; no source copied.** |
| [kosciukiewicz/sbc-solver](https://github.com/kosciukiewicz/sbc-solver/tree/126483eee2257541c832751f853d7ce87a7f4e33) | MIT, Copyright (c) 2024 Witold Kościukiewicz | Browser worker and player-blocking UX reference | **Ideas only.** No source, EA assets, opaque WASM engine or dependency copied. |
| [FreyGold/solva-sbc-solver](https://github.com/FreyGold/solva-sbc-solver/tree/0e63c1422335dae27e135ed917c9cf2ac56da8c5) | **No explicit license found** | FC26 identity, preservation, synchronization and benchmark behavior | **Reference only; independently reimplemented. No source/tests/fixtures copied.** |
| [SunFlower-Nz/fc26-copilot](https://github.com/SunFlower-Nz/fc26-copilot/tree/cab71138c7e35c21305401264b5849d77f0a5c50) | **No explicit license found** | EA interaction/service boundaries, caches, parser/analyzer, protection and logging | **Architecture reference only; no source copied.** |
| [Eng-Abdelrahman-Mostafa/fc26-copilot](https://github.com/Eng-Abdelrahman-Mostafa/fc26-copilot/tree/dcaaaa1d3fc7c99fe8e5eaaf05d70c9f5a32ef38) | **No explicit license found** | Parent architecture cross-check | **Architecture reference only; no source copied.** |

## Auto-SBC MIT notice

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Excluded artifacts

The reviewed AutoPilot snapshot included unused `glpk.js` and `glpk.wasm`
artifacts without corresponding build sources in that repository. They and all
other opaque solver binaries are intentionally excluded from FUT Magic.

## Bundled UI dependency

The FUT Magic Side Panel bundles Preact (MIT), Copyright (c) 2015-present
Jason Miller. Its MIT permission and warranty text is shipped alongside the
bundle in `LICENSES/PREACT.txt`.
