# Third-party notices

This project is a derived work based primarily on
[AutoPilot-SBC](https://github.com/icysymmetra/AutoPilot-SBC), licensed under
the GNU General Public License v3.0 (reviewed commit
`ebf5d1e90f13329841896d8be227b3d55dd28c3b`). The combined project is
distributed under the same license; see `LICENSE`.

Selected domain ideas were adapted from
[Auto-SBC](https://github.com/titiroMonkey/Auto-SBC), licensed under the MIT
License (reviewed commit `98279901aab056dd1189df763b750ea86095e3fb`;
the userscript identifies its author as TitiroMonkey). No Python/FastAPI
runtime or Tampermonkey bundle is distributed here.

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

## Removed bundled GLPK artifacts

The upstream AutoPilot-SBC snapshot included unused `glpk.js` and `glpk.wasm`
artifacts without corresponding build sources in the repository. They are not
referenced by the runtime and are intentionally excluded from this derivative
to reduce attack surface and avoid distributing unverifiable binary artifacts.
