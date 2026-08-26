"use strict";
(() => {
  // node_modules/preact/dist/preact.module.js
  var n;
  var l;
  var u;
  var t;
  var i;
  var r;
  var o;
  var e;
  var f;
  var c;
  var a;
  var s;
  var h;
  var p;
  var v;
  var y;
  var d = {};
  var w = [];
  var _ = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
  var g = Array.isArray;
  function m(n2, l3) {
    for (var u4 in l3) n2[u4] = l3[u4];
    return n2;
  }
  function b(n2) {
    n2 && n2.parentNode && n2.parentNode.removeChild(n2);
  }
  function k(l3, u4, t3) {
    var i4, r3, o3, e3 = {};
    for (o3 in u4) "key" == o3 ? i4 = u4[o3] : "ref" == o3 ? r3 = u4[o3] : e3[o3] = u4[o3];
    if (arguments.length > 2 && (e3.children = arguments.length > 3 ? n.call(arguments, 2) : t3), "function" == typeof l3 && null != l3.defaultProps) for (o3 in l3.defaultProps) void 0 === e3[o3] && (e3[o3] = l3.defaultProps[o3]);
    return x(l3, e3, i4, r3, null);
  }
  function x(n2, t3, i4, r3, o3) {
    var e3 = { type: n2, props: t3, key: i4, ref: r3, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: null == o3 ? ++u : o3, __i: -1, __u: 0 };
    return null == o3 && null != l.vnode && l.vnode(e3), e3;
  }
  function S(n2) {
    return n2.children;
  }
  function C(n2, l3) {
    this.props = n2, this.context = l3;
  }
  function $(n2, l3) {
    if (null == l3) return n2.__ ? $(n2.__, n2.__i + 1) : null;
    for (var u4; l3 < n2.__k.length; l3++) if (null != (u4 = n2.__k[l3]) && null != u4.__e) return u4.__e;
    return "function" == typeof n2.type ? $(n2) : null;
  }
  function I(n2) {
    if (n2.__P && n2.__d) {
      var u4 = n2.__v, t3 = u4.__e, i4 = [], r3 = [], o3 = m({}, u4);
      o3.__v = u4.__v + 1, l.vnode && l.vnode(o3), q(n2.__P, o3, u4, n2.__n, n2.__P.namespaceURI, 32 & u4.__u ? [t3] : null, i4, null == t3 ? $(u4) : t3, !!(32 & u4.__u), r3), o3.__v = u4.__v, o3.__.__k[o3.__i] = o3, D(i4, o3, r3), u4.__e = u4.__ = null, o3.__e != t3 && P(o3);
    }
  }
  function P(n2) {
    if (null != (n2 = n2.__) && null != n2.__c) return n2.__e = n2.__c.base = null, n2.__k.some(function(l3) {
      if (null != l3 && null != l3.__e) return n2.__e = n2.__c.base = l3.__e;
    }), P(n2);
  }
  function A(n2) {
    (!n2.__d && (n2.__d = true) && i.push(n2) && !H.__r++ || r != l.debounceRendering) && ((r = l.debounceRendering) || o)(H);
  }
  function H() {
    try {
      for (var n2, l3 = 1; i.length; ) i.length > l3 && i.sort(e), n2 = i.shift(), l3 = i.length, I(n2);
    } finally {
      i.length = H.__r = 0;
    }
  }
  function L(n2, l3, u4, t3, i4, r3, o3, e3, f4, c3, a3) {
    var s3, h3, p3, v3, y3, _2, g2 = t3 && t3.__k || w, m3 = l3.length;
    for (f4 = T(u4, l3, g2, f4, m3), s3 = 0; s3 < m3; s3++) null != (p3 = u4.__k[s3]) && (h3 = -1 != p3.__i && g2[p3.__i] || d, p3.__i = s3, _2 = q(n2, p3, h3, i4, r3, o3, e3, f4, c3, a3), v3 = p3.__e, p3.ref && h3.ref != p3.ref && (h3.ref && J(h3.ref, null, p3), a3.push(p3.ref, p3.__c || v3, p3)), null == y3 && null != v3 && (y3 = v3), 4 & p3.__u ? (f4 = j(p3, f4, n2), h3.__e && (h3.__e = null)) : "function" == typeof p3.type && void 0 !== _2 ? f4 = _2 : v3 && (f4 = v3.nextSibling), p3.__u &= -7);
    return u4.__e = y3, f4;
  }
  function T(n2, l3, u4, t3, i4) {
    var r3, o3, e3, f4, c3, a3 = u4.length, s3 = a3, h3 = 0;
    for (n2.__k = new Array(i4), r3 = 0; r3 < i4; r3++) null != (o3 = l3[r3]) && "boolean" != typeof o3 && "function" != typeof o3 ? ("string" == typeof o3 || "number" == typeof o3 || "bigint" == typeof o3 || o3.constructor == String ? o3 = n2.__k[r3] = x(null, o3, null, null, null) : g(o3) ? o3 = n2.__k[r3] = x(S, { children: o3 }, null, null, null) : void 0 === o3.constructor && o3.__b > 0 ? o3 = n2.__k[r3] = x(o3.type, o3.props, o3.key, o3.ref ? o3.ref : null, o3.__v) : n2.__k[r3] = o3, f4 = r3 + h3, o3.__ = n2, o3.__b = n2.__b + 1, e3 = null, -1 != (c3 = o3.__i = O(o3, u4, f4, s3)) && (s3--, (e3 = u4[c3]) && (e3.__u |= 2)), null == e3 || null == e3.__v ? (-1 == c3 && (i4 > a3 ? h3-- : i4 < a3 && h3++), "function" != typeof o3.type && (o3.__u |= 4)) : c3 != f4 && (c3 == f4 - 1 ? h3-- : c3 == f4 + 1 ? h3++ : (c3 > f4 ? h3-- : h3++, o3.__u |= 4))) : n2.__k[r3] = null;
    if (s3) for (r3 = 0; r3 < a3; r3++) null != (e3 = u4[r3]) && 0 == (2 & e3.__u) && (e3.__e == t3 && (t3 = $(e3)), K(e3, e3));
    return t3;
  }
  function j(n2, l3, u4) {
    var t3, i4;
    if ("function" == typeof n2.type) {
      for (t3 = n2.__k, i4 = 0; t3 && i4 < t3.length; i4++) t3[i4] && (t3[i4].__ = n2, l3 = j(t3[i4], l3, u4));
      return l3;
    }
    n2.__e != l3 && (l3 && n2.type && !l3.parentNode && (l3 = $(n2)), l3 = u4.insertBefore(n2.__e, l3 || null));
    do {
      l3 = l3 && l3.nextSibling;
    } while (null != l3 && 8 == l3.nodeType);
    return l3;
  }
  function O(n2, l3, u4, t3) {
    var i4, r3, o3, e3 = n2.key, f4 = n2.type, c3 = l3[u4], a3 = null != c3 && 0 == (2 & c3.__u);
    if (null === c3 && null == e3 || a3 && e3 == c3.key && f4 == c3.type) return u4;
    if (t3 > (a3 ? 1 : 0)) {
      for (i4 = u4 - 1, r3 = u4 + 1; i4 >= 0 || r3 < l3.length; ) if (null != (c3 = l3[o3 = i4 >= 0 ? i4-- : r3++]) && 0 == (2 & c3.__u) && e3 == c3.key && f4 == c3.type) return o3;
    }
    return -1;
  }
  function z(n2, l3, u4) {
    "-" == l3[0] ? n2.setProperty(l3, null == u4 ? "" : u4) : n2[l3] = null == u4 ? "" : "number" != typeof u4 || _.test(l3) ? u4 : u4 + "px";
  }
  function N(n2, l3, u4, t3, i4) {
    var r3, o3;
    n: if ("style" == l3) if ("string" == typeof u4) n2.style.cssText = u4;
    else {
      if ("string" == typeof t3 && (n2.style.cssText = t3 = ""), t3) for (l3 in t3) u4 && l3 in u4 || z(n2.style, l3, "");
      if (u4) for (l3 in u4) t3 && u4[l3] == t3[l3] || z(n2.style, l3, u4[l3]);
    }
    else if ("o" == l3[0] && "n" == l3[1]) r3 = l3 != (l3 = l3.replace(s, "$1")), o3 = l3.toLowerCase(), l3 = o3 in n2 || "onFocusOut" == l3 || "onFocusIn" == l3 ? o3.slice(2) : l3.slice(2), n2.l || (n2.l = {}), n2.l[l3 + r3] = u4, u4 ? t3 ? u4[a] = t3[a] : (u4[a] = h, n2.addEventListener(l3, r3 ? v : p, r3)) : n2.removeEventListener(l3, r3 ? v : p, r3);
    else {
      if ("http://www.w3.org/2000/svg" == i4) l3 = l3.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
      else if ("width" != l3 && "height" != l3 && "href" != l3 && "list" != l3 && "form" != l3 && "tabIndex" != l3 && "download" != l3 && "rowSpan" != l3 && "colSpan" != l3 && "role" != l3 && "popover" != l3 && l3 in n2) try {
        n2[l3] = null == u4 ? "" : u4;
        break n;
      } catch (n3) {
      }
      "function" == typeof u4 || (null == u4 || false === u4 && "-" != l3[4] ? n2.removeAttribute(l3) : n2.setAttribute(l3, "popover" == l3 && 1 == u4 ? "" : u4));
    }
  }
  function V(n2) {
    return function(u4) {
      if (this.l) {
        var t3 = this.l[u4.type + n2];
        if (null == u4[c]) u4[c] = h++;
        else if (u4[c] < t3[a]) return;
        return t3(l.event ? l.event(u4) : u4);
      }
    };
  }
  function q(n2, u4, t3, i4, r3, o3, e3, f4, c3, a3) {
    var s3, h3, p3, v3, y3, d3, _2, k3, x2, M, I2, P2, A3, H2, T3, j3, F = u4.type;
    if (void 0 !== u4.constructor) return null;
    128 & t3.__u && (c3 = !!(32 & t3.__u), o3 = [f4 = u4.__e = t3.__e]), (s3 = l.__b) && s3(u4);
    n: if ("function" == typeof F) {
      h3 = e3.length;
      try {
        if (x2 = u4.props, M = F.prototype && F.prototype.render, I2 = (s3 = F.contextType) && i4[s3.__c], P2 = s3 ? I2 ? I2.props.value : s3.__ : i4, t3.__c ? k3 = (p3 = u4.__c = t3.__c).__ = p3.__E : (M ? u4.__c = p3 = new F(x2, P2) : (u4.__c = p3 = new C(x2, P2), p3.constructor = F, p3.render = Q), I2 && I2.sub(p3), p3.state || (p3.state = {}), p3.__n = i4, v3 = p3.__d = true, p3.__h = [], p3._sb = []), M && null == p3.__s && (p3.__s = p3.state), M && null != F.getDerivedStateFromProps && (p3.__s == p3.state && (p3.__s = m({}, p3.__s)), m(p3.__s, F.getDerivedStateFromProps(x2, p3.__s))), y3 = p3.props, d3 = p3.state, p3.__v = u4, v3) M && null == F.getDerivedStateFromProps && null != p3.componentWillMount && p3.componentWillMount(), M && null != p3.componentDidMount && p3.__h.push(p3.componentDidMount);
        else {
          if (M && null == F.getDerivedStateFromProps && x2 !== y3 && null != p3.componentWillReceiveProps && p3.componentWillReceiveProps(x2, P2), u4.__v == t3.__v || !p3.__e && null != p3.shouldComponentUpdate && false === p3.shouldComponentUpdate(x2, p3.__s, P2)) {
            u4.__v != t3.__v && (p3.props = x2, p3.state = p3.__s, p3.__d = false), u4.__e = t3.__e, u4.__k = t3.__k, u4.__k.some(function(n3) {
              n3 && (n3.__ = u4);
            }), w.push.apply(p3.__h, p3._sb), p3._sb = [], p3.__h.length && e3.push(p3), f4 = $(t3);
            break n;
          }
          null != p3.componentWillUpdate && p3.componentWillUpdate(x2, p3.__s, P2), M && null != p3.componentDidUpdate && p3.__h.push(function() {
            p3.componentDidUpdate(y3, d3, _2);
          });
        }
        if (p3.context = P2, p3.props = x2, p3.__P = n2, p3.__e = false, A3 = l.__r, H2 = 0, M) p3.state = p3.__s, p3.__d = false, A3 && A3(u4), s3 = p3.render(p3.props, p3.state, p3.context), w.push.apply(p3.__h, p3._sb), p3._sb = [];
        else do {
          p3.__d = false, A3 && A3(u4), s3 = p3.render(p3.props, p3.state, p3.context), p3.state = p3.__s;
        } while (p3.__d && ++H2 < 25);
        p3.state = p3.__s, null != p3.getChildContext && (i4 = m(m({}, i4), p3.getChildContext())), M && !v3 && null != p3.getSnapshotBeforeUpdate && (_2 = p3.getSnapshotBeforeUpdate(y3, d3)), T3 = null != s3 && s3.type === S && null == s3.key ? E(s3.props.children) : s3, f4 = L(n2, g(T3) ? T3 : [T3], u4, t3, i4, r3, o3, e3, f4, c3, a3), p3.base = u4.__e, u4.__u &= -161, p3.__h.length && e3.push(p3), k3 && (p3.__E = p3.__ = null);
      } catch (n3) {
        if (e3.length = h3, u4.__v = null, c3 || null != o3) {
          if (n3.then) {
            for (u4.__u |= c3 ? 160 : 128; f4 && 8 == f4.nodeType && f4.nextSibling; ) f4 = f4.nextSibling;
            null != o3 && (o3[o3.indexOf(f4)] = null), u4.__e = f4;
          } else if (null != o3) for (j3 = o3.length; j3--; ) b(o3[j3]);
        } else u4.__e = t3.__e;
        null == u4.__k && (u4.__k = t3.__k || []), n3.then || B(u4), l.__e(n3, u4, t3);
      }
    } else null == o3 && u4.__v == t3.__v ? (u4.__k = t3.__k, u4.__e = t3.__e) : f4 = u4.__e = G(t3.__e, u4, t3, i4, r3, o3, e3, c3, a3);
    return (s3 = l.diffed) && s3(u4), 128 & u4.__u ? void 0 : f4;
  }
  function B(n2) {
    n2 && (n2.__c && (n2.__c.__e = true), n2.__k && n2.__k.some(B));
  }
  function D(n2, u4, t3) {
    for (var i4 = 0; i4 < t3.length; i4++) J(t3[i4], t3[++i4], t3[++i4]);
    l.__c && l.__c(u4, n2), n2.some(function(u5) {
      try {
        n2 = u5.__h, u5.__h = [], n2.some(function(n3) {
          n3.call(u5);
        });
      } catch (n3) {
        l.__e(n3, u5.__v);
      }
    });
  }
  function E(n2) {
    return "object" != typeof n2 || null == n2 || n2.__b > 0 ? n2 : g(n2) ? n2.map(E) : void 0 !== n2.constructor ? null : m({}, n2);
  }
  function G(u4, t3, i4, r3, o3, e3, f4, c3, a3) {
    var s3, h3, p3, v3, y3, w3, _2, m3 = i4.props || d, k3 = t3.props, x2 = t3.type;
    if ("svg" == x2 ? o3 = "http://www.w3.org/2000/svg" : "math" == x2 ? o3 = "http://www.w3.org/1998/Math/MathML" : o3 || (o3 = "http://www.w3.org/1999/xhtml"), null != e3) {
      for (s3 = 0; s3 < e3.length; s3++) if ((y3 = e3[s3]) && "setAttribute" in y3 == !!x2 && (x2 ? y3.localName == x2 : 3 == y3.nodeType)) {
        u4 = y3, e3[s3] = null;
        break;
      }
    }
    if (null == u4) {
      if (null == x2) return document.createTextNode(k3);
      u4 = document.createElementNS(o3, x2, k3.is && k3), c3 && (l.__m && l.__m(t3, e3), c3 = false), e3 = null;
    }
    if (null == x2) m3 === k3 || c3 && u4.data == k3 || (u4.data = k3);
    else {
      if (e3 = "textarea" == x2 && null != k3.defaultValue ? null : e3 && n.call(u4.childNodes), !c3 && null != e3) for (m3 = {}, s3 = 0; s3 < u4.attributes.length; s3++) m3[(y3 = u4.attributes[s3]).name] = y3.value;
      for (s3 in m3) y3 = m3[s3], "dangerouslySetInnerHTML" == s3 ? p3 = y3 : "children" == s3 || s3 in k3 || "value" == s3 && "defaultValue" in k3 || "checked" == s3 && "defaultChecked" in k3 || N(u4, s3, null, y3, o3);
      for (s3 in k3) y3 = k3[s3], "children" == s3 ? v3 = y3 : "dangerouslySetInnerHTML" == s3 ? h3 = y3 : "value" == s3 ? w3 = y3 : "checked" == s3 ? _2 = y3 : c3 && "function" != typeof y3 || m3[s3] === y3 || N(u4, s3, y3, m3[s3], o3);
      if (h3) c3 || p3 && (h3.__html == p3.__html || h3.__html == u4.innerHTML) || (u4.innerHTML = h3.__html), t3.__k = [];
      else if (p3 && (u4.innerHTML = ""), L("template" == t3.type ? u4.content : u4, g(v3) ? v3 : [v3], t3, i4, r3, "foreignObject" == x2 ? "http://www.w3.org/1999/xhtml" : o3, e3, f4, e3 ? e3[0] : i4.__k && $(i4, 0), c3, a3), null != e3) for (s3 = e3.length; s3--; ) b(e3[s3]);
      c3 && "textarea" != x2 || (s3 = "value", "progress" == x2 && null == w3 ? u4.removeAttribute("value") : null != w3 && (w3 !== u4[s3] || "progress" == x2 && !w3 || "option" == x2 && w3 != m3[s3]) && N(u4, s3, w3, m3[s3], o3), s3 = "checked", null != _2 && _2 != u4[s3] && N(u4, s3, _2, m3[s3], o3));
    }
    return u4;
  }
  function J(n2, u4, t3) {
    try {
      if ("function" == typeof n2) {
        var i4 = "function" == typeof n2.__u;
        i4 && n2.__u(), i4 && null == u4 || (n2.__u = n2(u4));
      } else n2.current = u4;
    } catch (n3) {
      l.__e(n3, t3);
    }
  }
  function K(n2, u4, t3) {
    var i4, r3;
    if (l.unmount && l.unmount(n2), (i4 = n2.ref) && (i4.current && i4.current != n2.__e || J(i4, null, u4)), null != (i4 = n2.__c)) {
      if (i4.componentWillUnmount) try {
        i4.componentWillUnmount();
      } catch (n3) {
        l.__e(n3, u4);
      }
      i4.base = i4.__P = i4.__n = null;
    }
    if (i4 = n2.__k) for (r3 = 0; r3 < i4.length; r3++) i4[r3] && K(i4[r3], u4, t3 || "function" != typeof n2.type);
    t3 || b(n2.__e), n2.__c = n2.__ = n2.__e = void 0;
  }
  function Q(n2, l3, u4) {
    return this.constructor(n2, u4);
  }
  function R(u4, t3, i4) {
    var r3, o3, e3, f4;
    t3 == document && (t3 = document.documentElement), l.__ && l.__(u4, t3), o3 = (r3 = "function" == typeof i4) ? null : i4 && i4.__k || t3.__k, e3 = [], f4 = [], q(t3, u4 = (!r3 && i4 || t3).__k = k(S, null, [u4]), o3 || d, d, t3.namespaceURI, !r3 && i4 ? [i4] : o3 ? null : t3.firstChild ? n.call(t3.childNodes) : null, e3, !r3 && i4 ? i4 : o3 ? o3.__e : t3.firstChild, r3, f4), D(e3, u4, f4), u4.props.children = null;
  }
  n = w.slice, l = { __e: function(n2, l3, u4, t3) {
    for (var i4, r3, o3; l3 = l3.__; ) if ((i4 = l3.__c) && !i4.__) try {
      if ((r3 = i4.constructor) && null != r3.getDerivedStateFromError && (i4.setState(r3.getDerivedStateFromError(n2)), o3 = i4.__d), null != i4.componentDidCatch && (i4.componentDidCatch(n2, t3 || {}), o3 = i4.__d), o3) return i4.__E = i4;
    } catch (l4) {
      n2 = l4;
    }
    throw n2;
  } }, u = 0, t = function(n2) {
    return null != n2 && void 0 === n2.constructor;
  }, C.prototype.setState = function(n2, l3) {
    var u4;
    u4 = null != this.__s && this.__s != this.state ? this.__s : this.__s = m({}, this.state), "function" == typeof n2 && (n2 = n2(m({}, u4), this.props)), n2 && m(u4, n2), null != n2 && this.__v && (l3 && this._sb.push(l3), A(this));
  }, C.prototype.forceUpdate = function(n2) {
    this.__v && (this.__e = true, n2 && this.__h.push(n2), A(this));
  }, C.prototype.render = S, i = [], o = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e = function(n2, l3) {
    return n2.__v.__b - l3.__v.__b;
  }, H.__r = 0, f = Math.random().toString(8), c = "__d" + f, a = "__a" + f, s = /(PointerCapture)$|Capture$/i, h = 0, p = V(false), v = V(true), y = 0;

  // node_modules/preact/hooks/dist/hooks.module.js
  var t2;
  var r2;
  var u2;
  var i2;
  var o2 = 0;
  var f2 = [];
  var c2 = l;
  var e2 = c2.__b;
  var a2 = c2.__r;
  var v2 = c2.diffed;
  var l2 = c2.__c;
  var m2 = c2.unmount;
  var p2 = c2.__;
  function s2(n2, t3) {
    c2.__h && c2.__h(r2, n2, o2 || t3), o2 = 0;
    var u4 = r2.__H || (r2.__H = { __: [], __h: [] });
    return n2 >= u4.__.length && u4.__.push({}), u4.__[n2];
  }
  function d2(n2) {
    return o2 = 1, y2(D2, n2);
  }
  function y2(n2, u4, i4) {
    var o3 = s2(t2++, 2);
    if (o3.t = n2, !o3.__c && (o3.__ = [i4 ? i4(u4) : D2(void 0, u4), function(n3) {
      var t3 = o3.__N ? o3.__N[0] : o3.__[0], r3 = o3.t(t3, n3);
      t3 !== r3 && (o3.__N = [r3, o3.__[1]], o3.__c.setState({}));
    }], o3.__c = r2, !r2.__f)) {
      var f4 = function(n3, t3, r3) {
        if (!o3.__c.__H) return true;
        var u5 = false, i5 = o3.__c.props !== n3;
        if (o3.__c.__H.__.some(function(n4) {
          if (n4.__N) {
            u5 = true;
            var t4 = n4.__[0];
            n4.__ = n4.__N, n4.__N = void 0, t4 !== n4.__[0] && (i5 = true);
          }
        }), c3) {
          var f5 = c3.call(this, n3, t3, r3);
          return u5 ? f5 || i5 : f5;
        }
        return !u5 || i5;
      };
      r2.__f = true;
      var c3 = r2.shouldComponentUpdate, e3 = r2.componentWillUpdate;
      r2.componentWillUpdate = function(n3, t3, r3) {
        if (this.__e) {
          var u5 = c3;
          c3 = void 0, f4(n3, t3, r3), c3 = u5;
        }
        e3 && e3.call(this, n3, t3, r3);
      }, r2.shouldComponentUpdate = f4;
    }
    return o3.__N || o3.__;
  }
  function h2(n2, u4) {
    var i4 = s2(t2++, 3);
    !c2.__s && C2(i4.__H, u4) && (i4.__ = n2, i4.u = u4, r2.__H.__h.push(i4));
  }
  function A2(n2) {
    return o2 = 5, T2(function() {
      return { current: n2 };
    }, []);
  }
  function T2(n2, r3) {
    var u4 = s2(t2++, 7);
    return C2(u4.__H, r3) && (u4.__ = n2(), u4.__H = r3, u4.__h = n2), u4.__;
  }
  function j2() {
    for (var n2; n2 = f2.shift(); ) {
      var t3 = n2.__H;
      if (n2.__P && t3) try {
        t3.__h.some(z2), t3.__h.some(B2), t3.__h = [];
      } catch (r3) {
        t3.__h = [], c2.__e(r3, n2.__v);
      }
    }
  }
  c2.__b = function(n2) {
    r2 = null, e2 && e2(n2);
  }, c2.__ = function(n2, t3) {
    n2 && t3.__k && t3.__k.__m && (n2.__m = t3.__k.__m), p2 && p2(n2, t3);
  }, c2.__r = function(n2) {
    a2 && a2(n2), t2 = 0;
    var i4 = (r2 = n2.__c).__H;
    i4 && (u2 === r2 ? (i4.__h = [], r2.__h = [], i4.__.some(function(n3) {
      n3.__N && (n3.__ = n3.__N), n3.u = n3.__N = void 0;
    })) : (i4.__h.some(z2), i4.__h.some(B2), i4.__h = [], t2 = 0)), u2 = r2;
  }, c2.diffed = function(n2) {
    v2 && v2(n2);
    var t3 = n2.__c;
    t3 && t3.__H && (t3.__H.__h.length && (1 !== f2.push(t3) && i2 === c2.requestAnimationFrame || ((i2 = c2.requestAnimationFrame) || w2)(j2)), t3.__H.__.some(function(n3) {
      n3.u && (n3.__H = n3.u, n3.u = void 0);
    })), u2 = r2 = null;
  }, c2.__c = function(n2, t3) {
    t3.some(function(n3) {
      try {
        n3.__h.some(z2), n3.__h = n3.__h.filter(function(n4) {
          return !n4.__ || B2(n4);
        });
      } catch (r3) {
        t3.some(function(n4) {
          n4.__h && (n4.__h = []);
        }), t3 = [], c2.__e(r3, n3.__v);
      }
    }), l2 && l2(n2, t3);
  }, c2.unmount = function(n2) {
    m2 && m2(n2);
    var t3, r3 = n2.__c;
    r3 && r3.__H && (r3.__H.__.some(function(n3) {
      try {
        z2(n3);
      } catch (n4) {
        t3 = n4;
      }
    }), r3.__H = void 0, t3 && c2.__e(t3, r3.__v));
  };
  var k2 = "function" == typeof requestAnimationFrame;
  function w2(n2) {
    var t3, r3 = function() {
      clearTimeout(u4), k2 && cancelAnimationFrame(t3), setTimeout(n2);
    }, u4 = setTimeout(r3, 35);
    k2 && (t3 = requestAnimationFrame(r3));
  }
  function z2(n2) {
    var t3 = r2, u4 = n2.__c;
    "function" == typeof u4 && (n2.__c = void 0, u4()), r2 = t3;
  }
  function B2(n2) {
    var t3 = r2;
    n2.__c = n2.__(), r2 = t3;
  }
  function C2(n2, t3) {
    return !n2 || n2.length !== t3.length || t3.some(function(t4, r3) {
      return t4 !== n2[r3];
    });
  }
  function D2(n2, t3) {
    return "function" == typeof t3 ? t3(n2) : t3;
  }

  // node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js
  var f3 = 0;
  var i3 = Array.isArray;
  function u3(e3, t3, n2, o3, i4, u4) {
    t3 || (t3 = {});
    var a3, c3, p3 = t3;
    if ("ref" in p3) for (c3 in p3 = {}, t3) "ref" == c3 ? a3 = t3[c3] : p3[c3] = t3[c3];
    var l3 = { type: e3, props: p3, key: n2, ref: a3, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: --f3, __i: -1, __u: 0, __source: i4, __self: u4 };
    if ("function" == typeof e3 && (a3 = e3.defaultProps)) for (c3 in a3) void 0 === p3[c3] && (p3[c3] = a3[c3]);
    return l.vnode && l.vnode(l3), l3;
  }

  // src/sidepanel/main.tsx
  var iconPaths = {
    home: "M4 11.2 12 4l8 7.2V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z",
    projects: "M5 5.5A1.5 1.5 0 0 1 6.5 4h3l1.5 2H18a1 1 0 0 1 1 1v11.5A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5z",
    club: "M12 3 4.5 6v5.5c0 4.5 3 7.6 7.5 9.5 4.5-1.9 7.5-5 7.5-9.5V6zm0 4.2 2 1.5-.75 2.35.75 2.35-2 1.45-2-1.45.75-2.35L10 8.7z",
    more: "M6 12h.01M12 12h.01M18 12h.01",
    chevron: "m9 5 7 7-7 7",
    back: "m15 5-7 7 7 7",
    alert: "M12 4 3.5 19h17zM12 9v4.5M12 17h.01",
    check: "m5 12 4 4L19 6",
    refresh: "M20 6v5h-5M4 18v-5h5M18.5 10A7 7 0 0 0 6.2 7.5L4 11m16 2-2.2 3.5A7 7 0 0 1 5.5 14",
    sbc: "M6 4h12v16H6zM9 8h6M9 12h6M9 16h3",
    recycle: "M7.2 7.4A6.5 6.5 0 0 1 18 9l1.5-2M18 9l-3-.5M16.8 16.6A6.5 6.5 0 0 1 6 15l-1.5 2M6 15l3 .5",
    duplicate: "M8 8h11v11H8zM5 16V5h11",
    protect: "M12 3 19 6v5.5c0 4.3-2.8 7.2-7 9.1-4.2-1.9-7-4.8-7-9.1V6zM9 12l2 2 4-4",
    evolution: "M7 18 17 6M10 6h7v7M5 8v10h10",
    optimize: "M4 17l5-5 4 3 7-8M16 7h4v4",
    pause: "M9 7v10M15 7v10",
    stop: "M8 8h8v8H8z",
    activity: "M4 12h4l2-5 4 10 2-5h4",
    settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 13.5l1.5 1.2-2 3.4-1.8-.7a7 7 0 0 1-2.2 1.3l-.3 1.9h-4l-.3-1.9a7 7 0 0 1-2.2-1.3l-1.8.7-2-3.4L5.5 13.5a7 7 0 0 1 0-3L4 9.3l2-3.4 1.8.7a7 7 0 0 1 2.2-1.3l.3-1.9h4l.3 1.9a7 7 0 0 1 2.2 1.3l1.8-.7 2 3.4-1.5 1.2a7 7 0 0 1 0 3z",
    spark: "M12 3c.6 4.8 2.2 6.4 7 7-4.8.6-6.4 2.2-7 7-.6-4.8-2.2-6.4-7-7 4.8-.6 6.4-2.2 7-7z",
    dot: "M12 12h.01"
  };
  function Icon({ name, size = 20 }) {
    return /* @__PURE__ */ u3("svg", { "aria-hidden": "true", width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", children: /* @__PURE__ */ u3("path", { d: iconPaths[name] }) });
  }
  function BrandMark() {
    return /* @__PURE__ */ u3("svg", { class: "brand-mark", "aria-hidden": "true", viewBox: "0 0 128 128", fill: "none", children: [
      /* @__PURE__ */ u3("path", { d: "M34 91 27 36l56-12-5 15-34 7 5 39c15 2 30-2 42-11", stroke: "var(--fm-accent-primary)", "stroke-width": "9", "stroke-linecap": "round", "stroke-linejoin": "round" }),
      /* @__PURE__ */ u3("path", { d: "M25 96c26 7 55 1 74-20", stroke: "var(--fm-accent-secondary)", "stroke-width": "8", "stroke-linecap": "round" }),
      /* @__PURE__ */ u3("path", { d: "m91 72 11 1-3 11", stroke: "var(--fm-accent-secondary)", "stroke-width": "7", "stroke-linecap": "round", "stroke-linejoin": "round" }),
      /* @__PURE__ */ u3("path", { d: "M99 27c0 8-4 12-12 12 8 0 12 4 12 12 0-8 4-12 12-12-8 0-12-4-12-12Z", fill: "var(--fm-text-primary)" })
    ] });
  }
  function BrandLockup({ plan, compact = false }) {
    if (!compact) return /* @__PURE__ */ u3("div", { class: "brand-lockup brand-lockup-full", children: [
      /* @__PURE__ */ u3(BrandMark, {}),
      /* @__PURE__ */ u3("span", { class: "brand-wordmark brand-wordmark-full", children: [
        /* @__PURE__ */ u3("b", { children: "FUT" }),
        " ",
        /* @__PURE__ */ u3("strong", { children: "Magic" })
      ] }),
      plan === "pro" ? /* @__PURE__ */ u3(ProBadge, {}) : null
    ] });
    return /* @__PURE__ */ u3("div", { class: `brand-lockup${compact ? " brand-lockup-compact" : ""}`, children: [
      /* @__PURE__ */ u3(BrandMark, {}),
      /* @__PURE__ */ u3("span", { class: "brand-wordmark", children: [
        /* @__PURE__ */ u3("b", { children: "FUT" }),
        " ",
        /* @__PURE__ */ u3("strong", { children: "Magic" })
      ] }),
      plan === "pro" ? /* @__PURE__ */ u3(ProBadge, {}) : null
    ] });
  }
  function ProBadge() {
    return /* @__PURE__ */ u3("span", { class: "pro-label", "aria-label": "FUT Magic Pro", children: "Pro" });
  }
  function StatusBadge({ state, children }) {
    return /* @__PURE__ */ u3("span", { class: `state-label state-${state}`, children: [
      /* @__PURE__ */ u3("span", { class: "state-dot" }),
      children
    ] });
  }
  var actionIcon = {
    "complete-sbc": "sbc",
    "grind-upgrades": "recycle",
    "clear-duplicates": "duplicate",
    "protect-cards": "protect",
    "plan-evolution": "evolution",
    "optimize-club": "optimize"
  };
  function ActionIcon({ actionId }) {
    return /* @__PURE__ */ u3("span", { class: "action-symbol", "aria-hidden": "true", children: /* @__PURE__ */ u3(Icon, { name: actionIcon[actionId] || "spark", size: 18 }) });
  }
  function CompatibilityStatus({ compatibility }) {
    if (!compatibility) return null;
    const stateLabel = compatibility.planningState === "observe_only" ? `${compatibility.gameLabel} · Observe only` : `${compatibility.gameLabel} · Planning off`;
    return /* @__PURE__ */ u3("section", { class: `compatibility-status compatibility-${compatibility.versionState}`, "aria-labelledby": "compatibility-title", "aria-describedby": "compatibility-message", role: "status", children: [
      /* @__PURE__ */ u3("div", { class: "compatibility-copy", children: [
        /* @__PURE__ */ u3("h2", { id: "compatibility-title", children: compatibility.title }),
        /* @__PURE__ */ u3("p", { id: "compatibility-message", children: compatibility.message })
      ] }),
      /* @__PURE__ */ u3("span", { class: "compatibility-state", "aria-label": `Compatibility state: ${stateLabel}`, children: stateLabel })
    ] });
  }
  var request = (action, command) => new Promise((resolve, reject) => {
    const requestId = `fm-panel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (!globalThis.chrome?.runtime?.sendMessage) {
      reject(new Error("FUT Magic extension messaging is unavailable"));
      return;
    }
    chrome.runtime.sendMessage({ type: "FUT_MAGIC_PANEL_REQUEST_V1", requestId, action, command }, (response) => {
      const error = chrome.runtime.lastError;
      if (error || !response?.ok) {
        reject(new Error(error?.message || response?.error?.message || "FUT Magic could not reach the EA Web App"));
      } else if (response?.requestId !== requestId) {
        reject(new Error("FUT Magic received a mismatched panel response"));
      } else if (response?.data?.protocolVersion !== 1) {
        reject(new Error("FUT Magic received an unsupported panel protocol"));
      } else resolve(response.data);
    });
  });
  var formatValue = (value) => value == null ? "—" : value.toLocaleString();
  var percent = (value) => value == null ? null : Math.round(value * 100);
  function Progress({ value, label }) {
    const known = value != null && Number.isFinite(value);
    const numeric = Math.max(0, Math.min(100, Math.round((value || 0) * 100)));
    return /* @__PURE__ */ u3("div", { class: `progress-track${known ? "" : " progress-unknown"}`, role: "progressbar", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": known ? numeric : void 0, "aria-valuetext": known ? `${numeric}%` : "Progress unavailable", children: /* @__PURE__ */ u3("span", { style: { transform: `scaleX(${numeric / 100})` } }) });
  }
  function RunCard({ run, onCommand }) {
    const total = run.progress.total;
    const ratio = total ? run.progress.current / total : 0;
    return /* @__PURE__ */ u3("section", { class: "focus-surface", "aria-labelledby": "active-run-title", children: [
      /* @__PURE__ */ u3("div", { class: "row between start", children: [
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("p", { class: "kicker", children: "Active run" }),
          /* @__PURE__ */ u3("h2", { id: "active-run-title", children: run.title })
        ] }),
        /* @__PURE__ */ u3(StatusBadge, { state: run.guard.state, children: run.status === "recovery_required" ? "Needs review" : run.status })
      ] }),
      /* @__PURE__ */ u3("div", { class: "row between run-progress", children: [
        /* @__PURE__ */ u3("span", { children: [
          run.progress.current,
          total ? ` of ${total}` : "",
          " ",
          run.progress.label
        ] }),
        /* @__PURE__ */ u3("span", { class: "secondary", children: run.modeLabel })
      ] }),
      /* @__PURE__ */ u3(Progress, { value: ratio, label: "Run progress" }),
      run.intervention ? /* @__PURE__ */ u3("div", { class: "inline-warning", role: "status", children: [
        /* @__PURE__ */ u3(Icon, { name: "alert", size: 18 }),
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("strong", { children: run.intervention.title }),
          /* @__PURE__ */ u3("p", { children: run.intervention.message })
        ] })
      ] }) : null,
      /* @__PURE__ */ u3("ol", { class: "run-steps", children: run.timeline.filter((step) => step.status === "completed" || step.active || step.status === "pending").slice(0, 5).map((step) => /* @__PURE__ */ u3("li", { class: step.active ? "current" : step.status === "completed" ? "complete" : "pending", children: [
        /* @__PURE__ */ u3("span", { class: "step-icon", children: /* @__PURE__ */ u3(Icon, { name: step.status === "completed" ? "check" : step.active ? "chevron" : "dot", size: 15 }) }),
        step.label
      ] })) }),
      /* @__PURE__ */ u3("div", { class: "row between guard-row", children: [
        /* @__PURE__ */ u3("span", { children: "Activity Guard" }),
        /* @__PURE__ */ u3("strong", { children: run.guard.label })
      ] }),
      /* @__PURE__ */ u3("div", { class: "button-row", children: [
        run.canPause ? /* @__PURE__ */ u3("button", { onClick: () => onCommand({ type: "PAUSE_RUN" }), children: [
          /* @__PURE__ */ u3(Icon, { name: "pause", size: 17 }),
          "Pause"
        ] }) : null,
        run.canResume ? /* @__PURE__ */ u3("button", { class: "primary", onClick: () => onCommand({ type: "RESUME_RUN" }), children: [
          /* @__PURE__ */ u3(Icon, { name: "refresh", size: 17 }),
          "Resume"
        ] }) : null,
        run.canStop ? /* @__PURE__ */ u3("button", { class: "danger-quiet", onClick: () => onCommand({ type: "STOP_RUN" }), children: [
          /* @__PURE__ */ u3(Icon, { name: "stop", size: 17 }),
          "Stop"
        ] }) : null
      ] })
    ] });
  }
  function ProjectSummary({ project, onOpen }) {
    const completion = percent(project.progress);
    const content = /* @__PURE__ */ u3(S, { children: [
      /* @__PURE__ */ u3("div", { class: "row between start", children: [
        /* @__PURE__ */ u3("div", { class: "truncate", children: [
          /* @__PURE__ */ u3("h3", { children: project.name }),
          /* @__PURE__ */ u3("p", { class: "secondary", children: project.totalSquads ? `${project.completedSquads} of ${project.totalSquads} squads` : `${project.requiredSquadsRemaining} squads remaining` })
        ] }),
        onOpen ? /* @__PURE__ */ u3(Icon, { name: "chevron", size: 18 }) : null
      ] }),
      /* @__PURE__ */ u3(Progress, { value: project.progress, label: `${project.name} progress` }),
      /* @__PURE__ */ u3("div", { class: "row between metadata", children: [
        /* @__PURE__ */ u3("span", { children: completion == null ? "Progress recorded locally" : `${completion}% complete` }),
        /* @__PURE__ */ u3("span", { children: project.source === "ea_import" ? "Synced from EA" : "Manual project" })
      ] })
    ] });
    return onOpen ? /* @__PURE__ */ u3("button", { class: "project-row", "data-project-id": project.id, onClick: onOpen, children: content }) : /* @__PURE__ */ u3("div", { class: "project-summary", children: content });
  }
  function Home({ vm, onCommand, go, openProtection }) {
    return /* @__PURE__ */ u3("div", { class: "screen", "aria-labelledby": "home-title", children: [
      /* @__PURE__ */ u3("h1", { id: "home-title", tabIndex: -1, children: "Home" }),
      vm.notice ? /* @__PURE__ */ u3("section", { class: `notice notice-${vm.notice.tone}`, role: vm.notice.tone === "error" ? "alert" : "status", children: [
        /* @__PURE__ */ u3(Icon, { name: "alert", size: 20 }),
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("strong", { children: vm.notice.title }),
          /* @__PURE__ */ u3("p", { children: vm.notice.message })
        ] })
      ] }) : null,
      vm.run ? /* @__PURE__ */ u3(RunCard, { run: vm.run, onCommand }) : null,
      !vm.run && vm.activeProject ? /* @__PURE__ */ u3("section", { class: "focus-surface", children: [
        /* @__PURE__ */ u3("p", { class: "kicker", children: "Current project" }),
        /* @__PURE__ */ u3(ProjectSummary, { project: vm.activeProject }),
        /* @__PURE__ */ u3("button", { class: `${vm.compatibility ? "" : "primary "}wide`, onClick: () => go("projects"), children: vm.compatibility ? "View project" : "Continue project" })
      ] }) : null,
      vm.context.challengeName ? /* @__PURE__ */ u3("section", { class: "context-line", children: [
        /* @__PURE__ */ u3("span", { class: "context-icon", children: /* @__PURE__ */ u3(Icon, { name: "projects", size: 18 }) }),
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("span", { class: "secondary", children: "Open in EA" }),
          /* @__PURE__ */ u3("strong", { children: vm.context.challengeName })
        ] })
      ] }) : null,
      /* @__PURE__ */ u3("section", { class: "section-block", "aria-labelledby": "goals-title", children: [
        /* @__PURE__ */ u3("h2", { id: "goals-title", children: "What do you want to do?" }),
        /* @__PURE__ */ u3("div", { class: "action-list", children: vm.actions.map((action) => /* @__PURE__ */ u3("button", { class: `action-row${action.plan === "pro" ? " action-row-pro" : ""}`, "data-protection-entry": action.id === "protect-cards" ? "home" : void 0, disabled: !action.enabled, "aria-describedby": !action.enabled ? `${action.id}-reason` : void 0, onClick: async () => {
          if (!action.command) return;
          if (action.id === "protect-cards" && action.command.type === "PREVIEW_FODDER_REVIEW") {
            openProtection();
            return;
          }
          await onCommand(action.command);
          if (action.id === "complete-sbc" && action.command.type === "PREVIEW_SBC_PROJECT") go("projects");
          if (action.id === "clear-duplicates" && action.command.type === "PREVIEW_CLEAR_DUPLICATES") go("club");
        }, children: [
          /* @__PURE__ */ u3(ActionIcon, { actionId: action.id }),
          /* @__PURE__ */ u3("span", { class: "action-copy", children: [
            /* @__PURE__ */ u3("strong", { children: action.label }),
            /* @__PURE__ */ u3("span", { id: `${action.id}-reason`, children: action.enabled ? action.description : action.disabledReason })
          ] }),
          action.plan === "pro" ? /* @__PURE__ */ u3(ProBadge, {}) : /* @__PURE__ */ u3(Icon, { name: "chevron", size: 18 })
        ] })) })
      ] })
    ] });
  }
  function SbcPlanPreview({ project, onCommand, planningBlockedReason }) {
    const plan = project.preview;
    if (planningBlockedReason) return /* @__PURE__ */ u3("section", { class: "plan-actions", "aria-labelledby": "plan-unavailable-title", children: [
      /* @__PURE__ */ u3("h2", { id: "plan-unavailable-title", children: "Planning unavailable" }),
      /* @__PURE__ */ u3("p", { class: "secondary plan-copy", children: planningBlockedReason }),
      /* @__PURE__ */ u3("p", { class: "migration-copy", children: "Project progress remains visible. No EA action is available." })
    ] });
    if (!plan) return /* @__PURE__ */ u3("section", { class: "plan-actions", "aria-labelledby": "plan-title", children: [
      /* @__PURE__ */ u3("h2", { id: "plan-title", children: "Current squad" }),
      project.planNotice ? /* @__PURE__ */ u3("div", { class: "inline-warning", role: "status", children: [
        /* @__PURE__ */ u3(Icon, { name: "alert", size: 18 }),
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("strong", { children: "Preview expired" }),
          /* @__PURE__ */ u3("p", { children: project.planNotice })
        ] })
      ] }) : null,
      /* @__PURE__ */ u3("p", { class: "secondary plan-copy", children: "Build a read-only proposal from the open EA challenge and your latest Club snapshot." }),
      /* @__PURE__ */ u3("button", { class: "primary wide", onClick: () => onCommand({ type: "PREVIEW_SBC_PROJECT", projectId: project.id }), children: "Preview current squad" }),
      /* @__PURE__ */ u3("p", { class: "migration-copy", children: "No cards are changed during preview." })
    ] });
    if (!plan.canApprove) return /* @__PURE__ */ u3("section", { class: "plan-actions", "aria-labelledby": "plan-blocked-title", children: [
      /* @__PURE__ */ u3("div", { class: "row between", children: [
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("p", { class: "kicker", children: "Protected preview" }),
          /* @__PURE__ */ u3("h2", { id: "plan-blocked-title", children: "Preview blocked" })
        ] }),
        /* @__PURE__ */ u3("span", { class: "state-label state-caution", children: [
          /* @__PURE__ */ u3("span", { class: "state-dot" }),
          "Safe stop"
        ] })
      ] }),
      /* @__PURE__ */ u3("div", { class: "blocker-list", children: plan.blockers.map((blocker) => /* @__PURE__ */ u3("p", { children: [
        /* @__PURE__ */ u3(Icon, { name: "alert", size: 17 }),
        blocker.message
      ] })) }),
      /* @__PURE__ */ u3("button", { class: "wide", onClick: () => onCommand({ type: "PREVIEW_SBC_PROJECT", projectId: project.id }), children: "Preview again" }),
      /* @__PURE__ */ u3("p", { class: "migration-copy", children: "Nothing was applied to the EA squad." })
    ] });
    const challengeLabel = plan.challengeName || "Open challenge";
    const ratingAlreadyNamed = plan.targetRating != null && new RegExp(`\\b${plan.targetRating}\\s*[-–]?\\s*rated\\b`, "i").test(challengeLabel);
    return /* @__PURE__ */ u3("section", { class: "plan-preview", "aria-labelledby": "plan-ready-title", children: [
      /* @__PURE__ */ u3("div", { class: "row between start", children: [
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("p", { class: "kicker", children: "Protected preview" }),
          /* @__PURE__ */ u3("h2", { id: "plan-ready-title", children: "Ready to build" })
        ] }),
        /* @__PURE__ */ u3("span", { class: "preview-badge", children: [
          /* @__PURE__ */ u3(Icon, { name: "check", size: 14 }),
          "No cards changed"
        ] })
      ] }),
      /* @__PURE__ */ u3("p", { class: "plan-challenge", children: [
        challengeLabel,
        plan.targetRating && !ratingAlreadyNamed ? ` · ${plan.targetRating} rated` : ""
      ] }),
      /* @__PURE__ */ u3("div", { class: "plan-metrics", "aria-label": "Squad preview summary", children: [
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("b", { children: plan.selectedCount }),
          /* @__PURE__ */ u3("span", { children: "cards" })
        ] }),
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("b", { children: plan.specialCount ? plan.specialCount : plan.ratingRange ? `${plan.ratingRange.min}–${plan.ratingRange.max}` : "—" }),
          /* @__PURE__ */ u3("span", { children: plan.specialCount ? "special used" : "rating range" })
        ] }),
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("b", { children: plan.selectedProtectedCount ?? "—" }),
          /* @__PURE__ */ u3("span", { children: "protected used" })
        ] })
      ] }),
      /* @__PURE__ */ u3("div", { class: "card-strip", "aria-label": "Selected cards", children: plan.cards.map((card, index) => /* @__PURE__ */ u3("div", { class: "preview-card", children: [
        /* @__PURE__ */ u3("b", { children: card.rating }),
        /* @__PURE__ */ u3("span", { children: card.name || `Card ${index + 1}` }),
        /* @__PURE__ */ u3("small", { children: [card.isDuplicate ? "Duplicate" : null, card.location === "sbc_storage" ? "Storage" : null, card.isSpecial ? "Special" : null].filter(Boolean).join(" · ") || "Club" })
      ] })) }),
      plan.explanations.length ? /* @__PURE__ */ u3("details", { children: [
        /* @__PURE__ */ u3("summary", { children: "Why these cards?" }),
        /* @__PURE__ */ u3("div", { class: "plan-explanations", children: plan.explanations.map((line) => /* @__PURE__ */ u3("p", { children: line })) })
      ] }) : null,
      /* @__PURE__ */ u3("button", { class: "primary wide", "aria-describedby": "approval-explanation", onClick: () => onCommand({ type: "APPROVE_SBC_PLAN", projectId: project.id, planId: plan.id }), children: plan.approvalLabel }),
      /* @__PURE__ */ u3("p", { class: "approval-copy", id: "approval-explanation", children: "Refreshes, verifies, then submits one re-solved squad. EA submissions cannot be undone." })
    ] });
  }
  function ProjectDetail({ project, back, onCommand, run, go, planningBlockedReason }) {
    return /* @__PURE__ */ u3("div", { class: "screen detail-screen", "aria-labelledby": "project-title", children: [
      /* @__PURE__ */ u3("button", { class: "back-button", onClick: back, children: [
        /* @__PURE__ */ u3(Icon, { name: "back", size: 18 }),
        "Projects"
      ] }),
      /* @__PURE__ */ u3("h1", { id: "project-title", tabIndex: -1, children: project.name }),
      /* @__PURE__ */ u3("p", { class: "subtitle", children: project.totalSquads ? `${project.completedSquads} of ${project.totalSquads} squads` : `${project.requiredSquadsRemaining} squads remaining` }),
      /* @__PURE__ */ u3(Progress, { value: project.progress, label: `${project.name} progress` }),
      run ? /* @__PURE__ */ u3("div", { class: "inline-warning", role: "status", children: [
        /* @__PURE__ */ u3(Icon, { name: "refresh", size: 18 }),
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("strong", { children: run.title }),
          /* @__PURE__ */ u3("p", { children: [
            run.currentStep?.label || run.status,
            " · ",
            /* @__PURE__ */ u3("button", { class: "inline-link", onClick: () => go("home"), children: "View run" })
          ] })
        ] })
      ] }) : /* @__PURE__ */ u3(SbcPlanPreview, { project, onCommand, planningBlockedReason }),
      /* @__PURE__ */ u3("section", { class: "section-block", children: [
        /* @__PURE__ */ u3("h2", { children: "Remaining" }),
        project.remainingRatings.length ? /* @__PURE__ */ u3("div", { class: "value-list", children: project.remainingRatings.map((item) => /* @__PURE__ */ u3("div", { class: "value-row", children: [
          /* @__PURE__ */ u3("span", { class: "rating", children: item.rating }),
          /* @__PURE__ */ u3("span", { children: [
            "Need ",
            item.needed
          ] }),
          /* @__PURE__ */ u3("span", { class: "secondary", children: [
            "Club ",
            formatValue(item.exactRatingInClub)
          ] })
        ] })) }) : /* @__PURE__ */ u3("p", { class: "empty-copy", children: "No exact rating demand is recorded." })
      ] }),
      project.remainingSpecials.length ? /* @__PURE__ */ u3("section", { class: "section-block", children: [
        /* @__PURE__ */ u3("h2", { children: "Special cards" }),
        /* @__PURE__ */ u3("div", { class: "value-list", children: project.remainingSpecials.map((item) => /* @__PURE__ */ u3("div", { class: "value-row", children: [
          /* @__PURE__ */ u3("span", { children: item.type.toUpperCase() }),
          /* @__PURE__ */ u3("span", { children: [
            "Need ",
            item.needed
          ] })
        ] })) })
      ] }) : null,
      /* @__PURE__ */ u3("section", { class: "section-block", children: [
        /* @__PURE__ */ u3("h2", { children: "Protection" }),
        project.protectionSummary.map((line) => /* @__PURE__ */ u3("p", { class: "explanation", children: [
          /* @__PURE__ */ u3(Icon, { name: "check", size: 17 }),
          line
        ] }))
      ] }),
      /* @__PURE__ */ u3("div", { class: "stacked-actions", children: [
        /* @__PURE__ */ u3("button", { disabled: Boolean(planningBlockedReason), onClick: () => onCommand({ type: "OPEN_LEGACY_UI", section: "Target Projects" }), children: "Open project tools" }),
        /* @__PURE__ */ u3("p", { class: "migration-copy", children: planningBlockedReason || "Advanced import, sync, and reserve controls." }),
        /* @__PURE__ */ u3("button", { class: "pro-control", disabled: true, children: [
          "Optimize entire project ",
          /* @__PURE__ */ u3(ProBadge, {})
        ] }),
        /* @__PURE__ */ u3("p", { class: "disabled-copy", children: "FUT Magic Pro optimization is not connected in this build." })
      ] })
    ] });
  }
  function Projects({ vm, onCommand, go }) {
    const [selectedId, setSelectedId] = d2(() => vm.projects.find((project) => project.preview)?.id || null);
    const restoreProjectId = A2(null);
    const selected = vm.projects.find((project) => project.id === selectedId) || null;
    const planningBlockedReason = vm.compatibility?.gameVersion === "fc27" ? "FC 27 planning is not verified in this build." : vm.compatibility ? "Confirm the game version before planning." : null;
    h2(() => {
      const timer = window.setTimeout(() => {
        if (selectedId) {
          document.querySelector("#project-title")?.focus();
          return;
        }
        const restoreId = restoreProjectId.current;
        restoreProjectId.current = null;
        if (restoreId) document.querySelector(`[data-project-id="${CSS.escape(restoreId)}"]`)?.focus();
      }, 0);
      return () => window.clearTimeout(timer);
    }, [selectedId]);
    if (selected) return /* @__PURE__ */ u3(ProjectDetail, { project: selected, back: () => {
      restoreProjectId.current = selected.id;
      setSelectedId(null);
    }, onCommand, run: vm.run, go, planningBlockedReason });
    return /* @__PURE__ */ u3("div", { class: "screen", "aria-labelledby": "projects-title", children: [
      /* @__PURE__ */ u3("div", { class: "row between", children: [
        /* @__PURE__ */ u3("h1", { id: "projects-title", tabIndex: -1, children: "Projects" }),
        /* @__PURE__ */ u3("button", { class: "icon-button", "aria-label": "Import the open SBC", disabled: Boolean(planningBlockedReason), onClick: () => onCommand({ type: "IMPORT_CURRENT_SBC_PROJECT" }), children: "+" })
      ] }),
      /* @__PURE__ */ u3("p", { class: "subtitle", children: planningBlockedReason || "Protect a long-term target while you grind." }),
      vm.projects.length ? /* @__PURE__ */ u3("div", { class: "project-list", children: vm.projects.map((project) => /* @__PURE__ */ u3(ProjectSummary, { project, onOpen: () => setSelectedId(project.id) })) }) : /* @__PURE__ */ u3("section", { class: "empty-state", children: [
        /* @__PURE__ */ u3(BrandMark, {}),
        /* @__PURE__ */ u3("h2", { children: "No active projects" }),
        /* @__PURE__ */ u3("p", { children: planningBlockedReason || "Open an SBC set in EA, then import it here. Unknown requirements will stay unknown." }),
        /* @__PURE__ */ u3("button", { class: "primary", disabled: Boolean(planningBlockedReason), onClick: () => onCommand({ type: "IMPORT_CURRENT_SBC_PROJECT" }), children: "Import open SBC" })
      ] })
    ] });
  }
  function RecommendedNext({ recommendation, batchSafeCount = 0 }) {
    if (!recommendation) return null;
    const includedInBatch = batchSafeCount > 0 && ["move_to_club", "move_to_sbc_storage"].includes(recommendation.kind);
    const statusLabel = {
      ready: "Verified suggestion",
      attention: "Needs attention",
      clear: "Clear",
      blocked: "Blocked",
      expired: "Expired"
    }[recommendation.status];
    const subject = recommendation.card ? `${recommendation.card.rating || "—"} ${recommendation.card.name || "Unidentified card"}${recommendation.card.isSpecial ? " · Special" : ""}${recommendation.card.isTradable === true ? " · Tradable" : recommendation.card.isTradable === false ? " · Untradeable" : ""}` : null;
    const evidence = String(recommendation.evidence || "").trim();
    const reason = String(recommendation.reason || "").trim();
    const showEvidence = evidence && evidence !== reason;
    const observed = Number.isFinite(recommendation.observedAt) && recommendation.observedAt > 0 ? `Checked ${new Date(recommendation.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Freshness unavailable";
    return /* @__PURE__ */ u3("section", { class: `recommended-next recommendation-${recommendation.status}`, "aria-labelledby": "recommended-next-title", children: [
      /* @__PURE__ */ u3("div", { class: "recommended-next-heading", children: [
        /* @__PURE__ */ u3("p", { children: includedInBatch ? "Priority within this batch" : "Recommended next" }),
        /* @__PURE__ */ u3("span", { children: statusLabel })
      ] }),
      /* @__PURE__ */ u3("h3", { id: "recommended-next-title", children: recommendation.title }),
      subject ? /* @__PURE__ */ u3("p", { class: "recommended-subject", children: subject }) : null,
      /* @__PURE__ */ u3("p", { class: "recommended-reason", children: reason }),
      /* @__PURE__ */ u3("p", { class: "recommended-readonly", children: includedInBatch ? `Already included in the ${batchSafeCount}-item approval above. This is a read-only priority, not a second action. Nothing changes automatically.` : "Suggestion only — nothing changes automatically." }),
      showEvidence ? /* @__PURE__ */ u3("details", { children: [
        /* @__PURE__ */ u3("summary", { children: [
          /* @__PURE__ */ u3("span", { children: "Why this recommendation?" }),
          /* @__PURE__ */ u3(Icon, { name: "chevron", size: 17 })
        ] }),
        /* @__PURE__ */ u3("p", { children: evidence })
      ] }) : null,
      /* @__PURE__ */ u3("small", { class: "recommended-observed", children: observed })
    ] });
  }
  function DuplicateRoutePreview({ vm, onCommand }) {
    const plan = vm.duplicateRoute;
    const recommendation = vm.routerRecommendation;
    if (!plan) {
      return vm.clubHealth.unassignedCount ? /* @__PURE__ */ u3("section", { class: "plan-actions", "aria-labelledby": "route-title", children: [
        /* @__PURE__ */ u3("p", { class: "kicker", children: "Safe route" }),
        /* @__PURE__ */ u3("h2", { id: "route-title", children: "Review Unassigned items" }),
        /* @__PURE__ */ u3("p", { class: "secondary plan-copy", children: "Preview one bounded set of verified moves to Club or SBC Storage." }),
        /* @__PURE__ */ u3("button", { class: "primary wide", onClick: () => onCommand({ type: "PREVIEW_CLEAR_DUPLICATES" }), children: "Review safe route" }),
        /* @__PURE__ */ u3("p", { class: "migration-copy", children: "Preview changes nothing. It does not build or submit an SBC, use Organizer, open a pack, or quicksell." }),
        /* @__PURE__ */ u3(RecommendedNext, { recommendation })
      ] }) : /* @__PURE__ */ u3("section", { class: "plan-actions", "aria-labelledby": "route-clear-title", children: [
        /* @__PURE__ */ u3("p", { class: "kicker", children: "Safe route" }),
        /* @__PURE__ */ u3("h2", { id: "route-clear-title", children: "Unassigned is clear" }),
        /* @__PURE__ */ u3("p", { class: "secondary plan-copy", children: "There are no current items to route." }),
        /* @__PURE__ */ u3(RecommendedNext, { recommendation })
      ] });
    }
    if (plan.status === "expired") return /* @__PURE__ */ u3("section", { class: "plan-actions", "aria-labelledby": "route-expired-title", children: [
      /* @__PURE__ */ u3("p", { class: "kicker", children: "Safe route" }),
      /* @__PURE__ */ u3("h2", { id: "route-expired-title", children: "Preview expired" }),
      /* @__PURE__ */ u3("div", { class: "inline-warning", role: "status", children: [
        /* @__PURE__ */ u3(Icon, { name: "alert", size: 18 }),
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("strong", { children: "Nothing moved" }),
          /* @__PURE__ */ u3("p", { children: plan.notice })
        ] })
      ] }),
      /* @__PURE__ */ u3("button", { class: "wide", onClick: () => onCommand({ type: "PREVIEW_CLEAR_DUPLICATES" }), children: "Preview again" }),
      /* @__PURE__ */ u3(RecommendedNext, { recommendation })
    ] });
    if (!plan.canApprove) return /* @__PURE__ */ u3("section", { class: "plan-actions", "aria-labelledby": "route-blocked-title", children: [
      /* @__PURE__ */ u3("div", { class: "row between", children: [
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("p", { class: "kicker", children: "Safe route" }),
          /* @__PURE__ */ u3("h2", { id: "route-blocked-title", children: plan.status === "clear" ? "Unassigned is clear" : "Preview blocked" })
        ] }),
        /* @__PURE__ */ u3("span", { class: "state-label state-caution", children: [
          /* @__PURE__ */ u3("span", { class: "state-dot" }),
          "Safe stop"
        ] })
      ] }),
      plan.blockers.length ? /* @__PURE__ */ u3("div", { class: "blocker-list", children: plan.blockers.map((blocker) => /* @__PURE__ */ u3("p", { children: [
        /* @__PURE__ */ u3(Icon, { name: "alert", size: 17 }),
        blocker.message
      ] })) }) : /* @__PURE__ */ u3("p", { class: "secondary plan-copy", children: "There are no verified moves to apply." }),
      /* @__PURE__ */ u3("button", { class: "wide", onClick: () => onCommand({ type: "PREVIEW_CLEAR_DUPLICATES" }), children: "Preview again" }),
      /* @__PURE__ */ u3("p", { class: "migration-copy", children: "Nothing was moved." }),
      /* @__PURE__ */ u3(RecommendedNext, { recommendation })
    ] });
    const safeCards = plan.cards.filter((card) => ["SEND_TO_CLUB", "MOVE_TO_SBC_STORAGE"].includes(card.action));
    const heldCards = plan.cards.filter((card) => !["SEND_TO_CLUB", "MOVE_TO_SBC_STORAGE"].includes(card.action));
    return /* @__PURE__ */ u3("section", { class: "plan-preview route-preview", "aria-labelledby": "route-ready-title", children: [
      /* @__PURE__ */ u3("div", { class: "row between start", children: [
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("p", { class: "kicker", children: "Safe route" }),
          /* @__PURE__ */ u3("h2", { id: "route-ready-title", children: "Ready to move" })
        ] }),
        /* @__PURE__ */ u3("span", { class: "preview-badge", children: [
          /* @__PURE__ */ u3(Icon, { name: "check", size: 14 }),
          "No cards changed"
        ] })
      ] }),
      /* @__PURE__ */ u3("div", { class: "plan-metrics", "aria-label": "Safe route summary", children: [
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("b", { children: plan.toClubCount }),
          /* @__PURE__ */ u3("span", { children: "to Club" })
        ] }),
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("b", { children: plan.toStorageCount }),
          /* @__PURE__ */ u3("span", { children: "to Storage" })
        ] }),
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("b", { children: plan.attentionCount }),
          /* @__PURE__ */ u3("span", { children: "need attention" })
        ] })
      ] }),
      /* @__PURE__ */ u3("div", { class: "route-group", children: [
        /* @__PURE__ */ u3("h3", { children: "Safe moves" }),
        /* @__PURE__ */ u3("div", { class: "card-strip", "aria-label": "Approved safe moves", children: safeCards.map((card, index) => /* @__PURE__ */ u3("div", { class: "preview-card", children: [
          /* @__PURE__ */ u3("b", { children: card.rating }),
          /* @__PURE__ */ u3("span", { children: card.name || `Card ${index + 1}` }),
          /* @__PURE__ */ u3("small", { children: [
            card.destination === "club" ? "Move to Club" : "Move to SBC Storage",
            " · ",
            card.reason
          ] })
        ] })) })
      ] }),
      heldCards.length ? /* @__PURE__ */ u3("div", { class: "route-group attention-group", children: [
        /* @__PURE__ */ u3("h3", { children: "Stays Unassigned" }),
        /* @__PURE__ */ u3("div", { class: "card-strip", "aria-label": "Items needing attention", children: heldCards.map((card, index) => /* @__PURE__ */ u3("div", { class: "preview-card", children: [
          /* @__PURE__ */ u3("b", { children: card.rating }),
          /* @__PURE__ */ u3("span", { children: card.name || `Card ${index + 1}` }),
          /* @__PURE__ */ u3("small", { children: card.reason })
        ] })) })
      ] }) : null,
      /* @__PURE__ */ u3("button", { class: "primary wide", "aria-describedby": "route-approval-explanation", onClick: () => onCommand({ type: "APPROVE_CLEAR_DUPLICATES_PLAN", planId: plan.id || void 0 }), children: plan.approvalLabel }),
      /* @__PURE__ */ u3("p", { class: "approval-copy", id: "route-approval-explanation", children: "Only the items shown under Safe moves can move. This does not build or submit an SBC, use Organizer, open a pack, or quicksell." }),
      /* @__PURE__ */ u3(RecommendedNext, { recommendation, batchSafeCount: plan.safeCount })
    ] });
  }
  function Club({ vm, onCommand, openProtection }) {
    const club = vm.clubHealth;
    const storageValue = club.storage.used == null ? "—" : `${club.storage.used}/${club.storage.capacity ?? "?"}`;
    const rows = [
      ["Unassigned", formatValue(club.unassignedCount), club.unassignedCount ? "Needs attention" : "Clear"],
      ["Duplicate groups", formatValue(club.duplicateGroupCount), "Exact-version groups"],
      ["SBC Storage", storageValue, club.storage.free == null ? "Unavailable" : `${club.storage.free} spaces free`],
      ...club.ratingBands.map((band) => [band.label, formatValue(band.club + band.storage), `${band.club} Club · ${band.storage} Storage`]),
      ["Protected cards", formatValue(club.protectedCount), "Review exclusions and reserves"]
    ];
    return /* @__PURE__ */ u3("div", { class: "screen", "aria-labelledby": "club-title", children: [
      /* @__PURE__ */ u3("div", { class: "row between", children: [
        /* @__PURE__ */ u3("h1", { id: "club-title", tabIndex: -1, children: "Club" }),
        /* @__PURE__ */ u3("button", { class: "icon-button", "aria-label": "Refresh club health", onClick: () => onCommand({ type: "REFRESH" }), children: /* @__PURE__ */ u3(Icon, { name: "refresh", size: 19 }) })
      ] }),
      /* @__PURE__ */ u3("p", { class: "subtitle", children: "Current Club health and one bounded Unassigned route." }),
      club.available ? /* @__PURE__ */ u3(S, { children: [
        /* @__PURE__ */ u3(DuplicateRoutePreview, { vm, onCommand }),
        /* @__PURE__ */ u3("div", { class: "health-list", children: rows.map(([label, value, detail]) => label === "Protected cards" ? /* @__PURE__ */ u3("button", { class: "health-row health-action", "data-protection-entry": "club", "aria-label": `Card protection, ${value}, ${detail}`, onClick: openProtection, children: [
          /* @__PURE__ */ u3("div", { children: [
            /* @__PURE__ */ u3("strong", { children: "Card protection" }),
            /* @__PURE__ */ u3("span", { children: detail })
          ] }),
          /* @__PURE__ */ u3("span", { class: "health-action-value", children: [
            /* @__PURE__ */ u3("b", { children: value }),
            /* @__PURE__ */ u3(Icon, { name: "chevron", size: 18 })
          ] })
        ] }) : /* @__PURE__ */ u3("div", { class: "health-row", children: [
          /* @__PURE__ */ u3("div", { children: [
            /* @__PURE__ */ u3("strong", { children: label }),
            /* @__PURE__ */ u3("span", { children: detail })
          ] }),
          /* @__PURE__ */ u3("b", { children: value })
        ] })) })
      ] }) : /* @__PURE__ */ u3("section", { class: "empty-state", children: [
        /* @__PURE__ */ u3("h2", { children: "Club data unavailable" }),
        /* @__PURE__ */ u3("p", { children: "Keep the EA Web App open while FUT Magic reconnects." }),
        /* @__PURE__ */ u3("button", { onClick: () => onCommand({ type: "REFRESH" }), children: "Try again" })
      ] })
    ] });
  }
  function More({ vm, onCommand, openProtection }) {
    const items = [
      ["Recipes", "Profiles", "Saved local grind configurations"],
      ["Activity", "Activity", "Recent verified actions and explanations"],
      ["Settings", "Settings", "Safety defaults and preferences"]
    ];
    return /* @__PURE__ */ u3("div", { class: "screen", "aria-labelledby": "more-title", children: [
      /* @__PURE__ */ u3("h1", { id: "more-title", tabIndex: -1, children: "More" }),
      /* @__PURE__ */ u3("div", { class: "settings-list", children: [
        /* @__PURE__ */ u3("button", { class: "settings-row", "data-protection-entry": "more", onClick: openProtection, children: [
          /* @__PURE__ */ u3("span", { class: "settings-icon", children: /* @__PURE__ */ u3(Icon, { name: "protect", size: 18 }) }),
          /* @__PURE__ */ u3("span", { children: [
            /* @__PURE__ */ u3("strong", { children: "Card protection" }),
            /* @__PURE__ */ u3("small", { children: "Review exclusions, reserves and selection preferences" })
          ] }),
          /* @__PURE__ */ u3(Icon, { name: "chevron", size: 18 })
        ] }),
        items.map(([label, section, description]) => /* @__PURE__ */ u3("button", { class: "settings-row", onClick: () => onCommand({ type: "OPEN_LEGACY_UI", section }), children: [
          /* @__PURE__ */ u3("span", { class: "settings-icon", children: /* @__PURE__ */ u3(Icon, { name: label === "Activity" ? "activity" : label === "Settings" ? "settings" : "recycle", size: 18 }) }),
          /* @__PURE__ */ u3("span", { children: [
            /* @__PURE__ */ u3("strong", { children: label }),
            /* @__PURE__ */ u3("small", { children: description })
          ] }),
          /* @__PURE__ */ u3(Icon, { name: "chevron", size: 18 })
        ] }))
      ] }),
      /* @__PURE__ */ u3("section", { class: "section-block", children: [
        /* @__PURE__ */ u3("h2", { children: "Advanced" }),
        /* @__PURE__ */ u3("div", { class: "settings-list inset", children: [
          /* @__PURE__ */ u3("button", { class: "settings-row", onClick: () => onCommand({ type: "OPEN_LEGACY_UI", section: "Workflows" }), children: [
            /* @__PURE__ */ u3("span", { children: [
              /* @__PURE__ */ u3("strong", { children: "Workflow recipes" }),
              /* @__PURE__ */ u3("small", { children: "Typed steps, retry limits and custom policies" })
            ] }),
            /* @__PURE__ */ u3(Icon, { name: "chevron", size: 18 })
          ] }),
          /* @__PURE__ */ u3("button", { class: "settings-row", onClick: () => onCommand({ type: "OPEN_LEGACY_UI", section: "Developer" }), children: [
            /* @__PURE__ */ u3("span", { children: [
              /* @__PURE__ */ u3("strong", { children: "Capability health & diagnostics" }),
              /* @__PURE__ */ u3("small", { children: "Adapter evidence and local support export" })
            ] }),
            /* @__PURE__ */ u3(Icon, { name: "chevron", size: 18 })
          ] }),
          /* @__PURE__ */ u3("button", { class: "settings-row", onClick: () => onCommand({ type: "OPEN_LEGACY_UI", section: "Easy Loop" }), children: [
            /* @__PURE__ */ u3("span", { children: [
              /* @__PURE__ */ u3("strong", { children: "Legacy tools" }),
              /* @__PURE__ */ u3("small", { children: "Open the full migration-period panel" })
            ] }),
            /* @__PURE__ */ u3(Icon, { name: "chevron", size: 18 })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ u3("section", { class: "about", children: [
        /* @__PURE__ */ u3("div", { class: "about-summary", children: [
          /* @__PURE__ */ u3(BrandLockup, { plan: vm.brand.plan }),
          /* @__PURE__ */ u3("div", { class: "about-copy", children: [
            /* @__PURE__ */ u3("p", { class: "brand-tagline", children: "Smarter plans. Better results." }),
            /* @__PURE__ */ u3("p", { children: [
              "Modified AutoPilot-SBC derivative · ",
              vm.legal.license
            ] }),
            /* @__PURE__ */ u3("p", { children: vm.legal.warranty }),
            /* @__PURE__ */ u3("p", { children: vm.legal.disclaimer })
          ] })
        ] }),
        /* @__PURE__ */ u3("div", { class: "legal-links", children: [
          /* @__PURE__ */ u3("a", { href: vm.legal.sourceUrl, target: "_blank", rel: "noreferrer", children: "Source" }),
          /* @__PURE__ */ u3("a", { href: vm.legal.licenseUrl, target: "_blank", rel: "noreferrer", children: "License" }),
          /* @__PURE__ */ u3("a", { href: vm.legal.privacyUrl, target: "_blank", rel: "noreferrer", children: "Privacy" }),
          /* @__PURE__ */ u3("a", { href: vm.legal.noticesUrl, target: "_blank", rel: "noreferrer", children: "Third-party notices" })
        ] })
      ] })
    ] });
  }
  var locationLabel = (location) => {
    const normalized = String(location || "").toLowerCase();
    if (normalized === "sbc_storage" || normalized === "storage") return "SBC Storage";
    if (normalized === "unassigned") return "Unassigned";
    return "Club";
  };
  var checkedAt = (observedAt) => Number.isFinite(observedAt) && observedAt > 0 ? `Checked ${new Date(observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Not checked yet";
  function ProtectionReview({ vm, back, backLabel, onCommand }) {
    const review = vm.protection;
    const count = review.uniqueHardProtectedCount;
    const statusTitle = review.status === "ready" ? count === 1 ? "1 card excluded from every solve" : `${formatValue(count)} cards excluded from every solve` : review.status === "blocked" ? "Protection review blocked" : review.status === "unverified" ? count == null || count === 0 ? "Protection evidence is incomplete" : count === 1 ? "At least 1 exclusion verified" : `At least ${formatValue(count)} exclusions verified` : "Protection review not ready";
    const projectHardSignals = review.projectSignals.filter((project) => project.hardExclusions.length);
    const projectKeepSignals = review.projectSignals.filter((project) => project.conservationPreferences.length);
    const projectEvidenceWarnings = review.projectSignals.filter((project) => project.unknownRequirementCount > 0).map((project) => `${project.name}: ${project.unknownRequirementCount} ${project.unknownRequirementCount === 1 ? "requirement is" : "requirements are"} excluded because the evidence is unverified.`);
    const evidenceWarnings = [.../* @__PURE__ */ new Set([...review.evidenceWarnings, ...projectEvidenceWarnings])];
    const hasKeepRules = review.ratingReserves.length || review.specialReserves.length || projectKeepSignals.length || review.preferences.length;
    return /* @__PURE__ */ u3("div", { class: "screen detail-screen protection-screen", "aria-labelledby": "protection-title", children: [
      /* @__PURE__ */ u3("button", { class: "back-button", onClick: back, children: [
        /* @__PURE__ */ u3(Icon, { name: "back", size: 18 }),
        backLabel
      ] }),
      /* @__PURE__ */ u3("div", { class: "row between start protection-heading", children: [
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("h1", { id: "protection-title", tabIndex: -1, children: "Card protection" }),
          /* @__PURE__ */ u3("p", { class: "subtitle", children: "What FUT Magic will never use—and what it tries to preserve." })
        ] }),
        /* @__PURE__ */ u3("button", { class: "icon-button", "aria-label": "Refresh card protection review", onClick: () => onCommand({ type: "PREVIEW_FODDER_REVIEW" }), children: /* @__PURE__ */ u3(Icon, { name: "refresh", size: 19 }) })
      ] }),
      /* @__PURE__ */ u3("section", { class: `protection-summary protection-summary-${review.status}`, "aria-labelledby": "protection-summary-title", children: [
        /* @__PURE__ */ u3("span", { class: "protection-shield", children: /* @__PURE__ */ u3(Icon, { name: "club", size: 22 }) }),
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("h2", { id: "protection-summary-title", children: statusTitle }),
          /* @__PURE__ */ u3("p", { children: review.verificationMessage || (review.status === "ready" ? `${formatValue(review.analyzedItemCount)} current Club and Storage cards analyzed.` : "Refresh while the EA Web App is open.") }),
          /* @__PURE__ */ u3("small", { children: checkedAt(review.observedAt) })
        ] })
      ] }),
      evidenceWarnings.length ? /* @__PURE__ */ u3("section", { class: "protection-warnings", "aria-labelledby": "protection-warnings-title", children: [
        /* @__PURE__ */ u3("h2", { id: "protection-warnings-title", children: "Needs attention" }),
        evidenceWarnings.map((warning) => /* @__PURE__ */ u3("p", { children: [
          /* @__PURE__ */ u3(Icon, { name: "alert", size: 17 }),
          warning
        ] }))
      ] }) : null,
      /* @__PURE__ */ u3("section", { class: "protection-section", "aria-labelledby": "never-use-title", children: [
        /* @__PURE__ */ u3("h2", { id: "never-use-title", children: "Never use" }),
        /* @__PURE__ */ u3("p", { class: "protection-intro", children: "These cards are removed before planning and checked again before submission. A card may match several rules; the summary counts each card once." }),
        /* @__PURE__ */ u3("div", { class: "protection-list", children: [
          review.reasonGroups.length ? review.reasonGroups.map((group) => /* @__PURE__ */ u3("details", { class: "protection-disclosure", children: [
            /* @__PURE__ */ u3("summary", { children: [
              /* @__PURE__ */ u3("span", { class: "protection-row-copy", children: [
                /* @__PURE__ */ u3("strong", { children: group.label }),
                /* @__PURE__ */ u3("small", { children: group.count === 1 ? "1 current card" : `${group.count} current cards` })
              ] }),
              /* @__PURE__ */ u3("span", { class: "protection-row-end", children: [
                /* @__PURE__ */ u3("b", { children: group.count }),
                /* @__PURE__ */ u3(Icon, { name: "chevron", size: 18 })
              ] })
            ] }),
            /* @__PURE__ */ u3("div", { class: "protection-detail", children: [
              /* @__PURE__ */ u3("p", { children: "Every card matching this rule is excluded while the rule remains active." }),
              group.examples.length ? /* @__PURE__ */ u3("ul", { class: "protection-examples", children: group.examples.map((example) => /* @__PURE__ */ u3("li", { children: [
                /* @__PURE__ */ u3("span", { class: "rating", children: example.rating || "—" }),
                /* @__PURE__ */ u3("span", { children: [
                  /* @__PURE__ */ u3("strong", { children: example.name || "Unnamed card" }),
                  /* @__PURE__ */ u3("small", { children: locationLabel(example.location) })
                ] })
              ] })) }) : /* @__PURE__ */ u3("p", { class: "empty-copy", children: "No card names are available in the current evidence." })
            ] })
          ] })) : /* @__PURE__ */ u3("p", { class: "protection-empty", children: "No current hard exclusions were verified." }),
          projectHardSignals.map((project) => /* @__PURE__ */ u3("details", { class: "protection-disclosure", children: [
            /* @__PURE__ */ u3("summary", { children: [
              /* @__PURE__ */ u3("span", { class: "protection-row-copy", children: [
                /* @__PURE__ */ u3("strong", { children: project.name }),
                /* @__PURE__ */ u3("small", { children: "Project exclusions" })
              ] }),
              /* @__PURE__ */ u3("span", { class: "protection-row-end", children: [
                /* @__PURE__ */ u3("b", { children: project.hardExclusions.length }),
                /* @__PURE__ */ u3(Icon, { name: "chevron", size: 18 })
              ] })
            ] }),
            /* @__PURE__ */ u3("div", { class: "protection-detail", children: /* @__PURE__ */ u3("ul", { class: "plain-rule-list", children: project.hardExclusions.map((rule) => /* @__PURE__ */ u3("li", { children: [
              /* @__PURE__ */ u3(Icon, { name: "check", size: 16 }),
              rule
            ] })) }) })
          ] }))
        ] })
      ] }),
      /* @__PURE__ */ u3("section", { class: "protection-section", "aria-labelledby": "try-keep-title", children: [
        /* @__PURE__ */ u3("h2", { id: "try-keep-title", children: "Try to keep" }),
        /* @__PURE__ */ u3("p", { class: "protection-intro", children: "These rules guide selection, but may yield when an SBC otherwise has no valid squad." }),
        hasKeepRules ? /* @__PURE__ */ u3("div", { class: "protection-list", children: [
          review.ratingReserves.map((reserve) => /* @__PURE__ */ u3("div", { class: "protection-static-row", children: [
            /* @__PURE__ */ u3("span", { class: "protection-row-copy", children: [
              /* @__PURE__ */ u3("strong", { children: [
                reserve.rating,
                "-rated cards"
              ] }),
              /* @__PURE__ */ u3("small", { children: reserve.observedCount == null ? "Current count unverified" : `${reserve.observedCount} currently observed` })
            ] }),
            /* @__PURE__ */ u3("span", { class: "protection-value", children: [
              "Keep ",
              reserve.minimum
            ] })
          ] })),
          review.specialReserves.map((reserve) => /* @__PURE__ */ u3("div", { class: "protection-static-row", children: [
            /* @__PURE__ */ u3("span", { class: "protection-row-copy", children: [
              /* @__PURE__ */ u3("strong", { children: reserve.cardType }),
              /* @__PURE__ */ u3("small", { children: reserve.observedCount == null ? "Current count unverified" : `${reserve.observedCount} currently observed` })
            ] }),
            /* @__PURE__ */ u3("span", { class: "protection-value", children: [
              "Keep ",
              reserve.minimum
            ] })
          ] })),
          projectKeepSignals.map((project) => /* @__PURE__ */ u3("details", { class: "protection-disclosure", children: [
            /* @__PURE__ */ u3("summary", { children: [
              /* @__PURE__ */ u3("span", { class: "protection-row-copy", children: [
                /* @__PURE__ */ u3("strong", { children: project.name }),
                /* @__PURE__ */ u3("small", { children: "Project preferences" })
              ] }),
              /* @__PURE__ */ u3("span", { class: "protection-row-end", children: [
                /* @__PURE__ */ u3("b", { children: project.conservationPreferences.length }),
                /* @__PURE__ */ u3(Icon, { name: "chevron", size: 18 })
              ] })
            ] }),
            /* @__PURE__ */ u3("div", { class: "protection-detail", children: /* @__PURE__ */ u3("ul", { class: "plain-rule-list", children: project.conservationPreferences.map((rule) => /* @__PURE__ */ u3("li", { children: [
              /* @__PURE__ */ u3(Icon, { name: "check", size: 16 }),
              rule
            ] })) }) })
          ] })),
          review.preferences.length ? /* @__PURE__ */ u3("div", { class: "preference-heading", children: [
            /* @__PURE__ */ u3("strong", { children: "When several safe squads work" }),
            /* @__PURE__ */ u3("small", { children: "FUT Magic applies enabled preferences in the order shown." })
          ] }) : null,
          review.preferences.map((preference) => /* @__PURE__ */ u3("div", { class: "protection-static-row", children: [
            /* @__PURE__ */ u3("span", { class: "protection-row-copy", children: [
              /* @__PURE__ */ u3("strong", { children: preference.label }),
              /* @__PURE__ */ u3("small", { children: "Selection preference" })
            ] }),
            /* @__PURE__ */ u3("span", { class: `preference-state preference-${preference.enabled ? "on" : "off"}`, children: preference.enabled ? "On" : "Off" })
          ] }))
        ] }) : /* @__PURE__ */ u3("p", { class: "protection-empty", children: "No reserve or selection preferences are configured." })
      ] }),
      /* @__PURE__ */ u3("section", { class: "protection-how", "aria-labelledby": "protection-how-title", children: [
        /* @__PURE__ */ u3("h2", { id: "protection-how-title", children: "How protection works" }),
        /* @__PURE__ */ u3("p", { children: [
          /* @__PURE__ */ u3("strong", { children: "Never use" }),
          " is an absolute exclusion. ",
          /* @__PURE__ */ u3("strong", { children: "Try to keep" }),
          " helps choose between valid, protected-safe squads without making a solvable SBC appear impossible."
        ] })
      ] }),
      /* @__PURE__ */ u3("button", { class: "wide protection-advanced", onClick: () => onCommand({ type: "OPEN_LEGACY_UI", section: "Protected Cards" }), children: "Advanced protection rules" }),
      /* @__PURE__ */ u3("p", { class: "migration-copy", children: review.advancedActive ? "Advanced local protection rules are active. Review or edit them in Legacy Tools." : "Review and edit advanced local rules in Legacy Tools." })
    ] });
  }
  function App() {
    const [route, setRoute] = d2("home");
    const [protectionOrigin, setProtectionOrigin] = d2("more");
    const [vm, setVm] = d2(null);
    const [error, setError] = d2(null);
    const [busy, setBusy] = d2(false);
    const headingTimer = A2(null);
    const restoreFocusSelector = A2(null);
    const appliedRevision = A2(-1);
    const applyViewModel = (next) => {
      if (next.revision < appliedRevision.current) return;
      appliedRevision.current = next.revision;
      setVm(next);
    };
    const refresh = async () => {
      try {
        applyViewModel(await request("SNAPSHOT"));
        setError(null);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    };
    h2(() => {
      void refresh();
      const timer = window.setInterval(() => {
        if (document.visibilityState === "visible") void refresh();
      }, 2500);
      const visible = () => {
        if (document.visibilityState === "visible") void refresh();
      };
      document.addEventListener("visibilitychange", visible);
      return () => {
        window.clearInterval(timer);
        document.removeEventListener("visibilitychange", visible);
      };
    }, []);
    h2(() => {
      if (headingTimer.current) window.clearTimeout(headingTimer.current);
      headingTimer.current = window.setTimeout(() => {
        if (restoreFocusSelector.current) {
          const target = document.querySelector(restoreFocusSelector.current);
          restoreFocusSelector.current = null;
          if (target) {
            target.focus();
            return;
          }
        }
        document.querySelector("main h1")?.focus();
      }, 0);
    }, [route]);
    const onCommand = async (command) => {
      if (busy) return;
      setBusy(true);
      try {
        applyViewModel(await request("COMMAND", command));
        setError(null);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        setBusy(false);
      }
    };
    const openProtection = (origin) => {
      setProtectionOrigin(origin);
      setRoute("protection");
      void onCommand({ type: "PREVIEW_FODDER_REVIEW" });
    };
    const closeProtection = () => {
      restoreFocusSelector.current = `[data-protection-entry="${protectionOrigin}"]`;
      setRoute(protectionOrigin);
    };
    const content = T2(() => {
      if (!vm) return null;
      if (route === "projects") return /* @__PURE__ */ u3(Projects, { vm, onCommand, go: setRoute });
      if (route === "club") return /* @__PURE__ */ u3(Club, { vm, onCommand, openProtection: () => openProtection("club") });
      if (route === "more") return /* @__PURE__ */ u3(More, { vm, onCommand, openProtection: () => openProtection("more") });
      if (route === "protection") return /* @__PURE__ */ u3(ProtectionReview, { vm, onCommand, back: closeProtection, backLabel: protectionOrigin === "home" ? "Home" : protectionOrigin === "club" ? "Club" : protectionOrigin === "projects" ? "Projects" : "More" });
      return /* @__PURE__ */ u3(Home, { vm, onCommand, go: setRoute, openProtection: () => openProtection("home") });
    }, [route, vm, busy, protectionOrigin]);
    const navRoute = route === "protection" ? protectionOrigin : route;
    return /* @__PURE__ */ u3("div", { class: "app-shell", "aria-busy": busy, children: [
      /* @__PURE__ */ u3("header", { class: "app-header", children: [
        /* @__PURE__ */ u3(BrandLockup, { plan: vm?.brand.plan, compact: true }),
        /* @__PURE__ */ u3("div", { class: `connection connection-${vm?.connection.state || "connecting"}`, children: [
          /* @__PURE__ */ u3("span", { class: "state-dot" }),
          vm?.connection.label || "Connecting"
        ] })
      ] }),
      /* @__PURE__ */ u3("main", { "aria-busy": busy, "aria-disabled": busy || void 0, inert: busy ? true : void 0, children: [
        /* @__PURE__ */ u3(CompatibilityStatus, { compatibility: vm?.compatibility || null }),
        error ? /* @__PURE__ */ u3("section", { class: "connection-error", role: "alert", children: [
          /* @__PURE__ */ u3(Icon, { name: "alert", size: 20 }),
          /* @__PURE__ */ u3("div", { children: [
            /* @__PURE__ */ u3("strong", { children: "Waiting for EA Web App" }),
            /* @__PURE__ */ u3("p", { children: error }),
            /* @__PURE__ */ u3("button", { onClick: () => void refresh(), children: "Try again" })
          ] })
        ] }) : null,
        content || /* @__PURE__ */ u3("div", { class: "loading", role: "status", "aria-atomic": "true", children: [
          /* @__PURE__ */ u3(BrandMark, {}),
          /* @__PURE__ */ u3("p", { children: "Connecting to the active EA Web App tab…" })
        ] })
      ] }),
      /* @__PURE__ */ u3("div", { class: "sr-live", "aria-live": "polite", "aria-atomic": "true", children: busy ? "Updating FUT Magic" : "" }),
      /* @__PURE__ */ u3("nav", { class: "bottom-nav", "aria-label": "FUT Magic", children: [
        /* @__PURE__ */ u3("button", { "aria-current": navRoute === "home" ? "page" : void 0, onClick: () => setRoute("home"), children: [
          /* @__PURE__ */ u3(Icon, { name: "home" }),
          /* @__PURE__ */ u3("span", { children: "Home" })
        ] }),
        /* @__PURE__ */ u3("button", { "aria-current": navRoute === "projects" ? "page" : void 0, onClick: () => setRoute("projects"), children: [
          /* @__PURE__ */ u3(Icon, { name: "projects" }),
          /* @__PURE__ */ u3("span", { children: "Projects" })
        ] }),
        /* @__PURE__ */ u3("button", { "aria-current": navRoute === "club" ? "page" : void 0, onClick: () => setRoute("club"), children: [
          /* @__PURE__ */ u3(Icon, { name: "club" }),
          /* @__PURE__ */ u3("span", { children: "Club" })
        ] }),
        /* @__PURE__ */ u3("button", { "aria-current": navRoute === "more" ? "page" : void 0, onClick: () => setRoute("more"), children: [
          /* @__PURE__ */ u3(Icon, { name: "more" }),
          /* @__PURE__ */ u3("span", { children: "More" })
        ] })
      ] })
    ] });
  }
  var root = document.getElementById("app");
  if (root) R(/* @__PURE__ */ u3(App, {}), root);
})();
