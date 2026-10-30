// Eve host script (ExtendScript, ES3). Loaded by the panel at startup.

function eveQuote(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
    .replace(/[\u0000-\u001f\u2028\u2029]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); }) + '"';
}

function eveJson(v) {
  var t = typeof v;
  if (v === null || v === undefined) return 'null';
  if (t === 'number') return isFinite(v) ? String(v) : 'null';
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'string') return eveQuote(v);
  if (v instanceof Array) {
    var a = [];
    for (var i = 0; i < v.length; i++) a.push(eveJson(v[i]));
    return '[' + a.join(',') + ']';
  }
  if (t === 'object') {
    var p = [];
    for (var k in v) { if (v.hasOwnProperty(k)) p.push(eveQuote(k) + ':' + eveJson(v[k])); }
    return '{' + p.join(',') + '}';
  }
  return eveQuote(String(v));
}

function eveTry(fn) {
  try { return eveJson(fn()); }
  catch (e) { return eveJson({ ok: false, message: e.toString(), line: e.line }); }
}

function eveSafeVal(v) {
  var t = typeof v;
  if (v === null || v === undefined) return null;
  if (t === 'number' || t === 'string' || t === 'boolean') return v;
  if (v instanceof Array) {
    var out = [];
    for (var i = 0; i < v.length && i < 16; i++) out.push(eveSafeVal(v[i]));
    return out;
  }
  return String(v);
}

function eveItemType(it) {
  if (it instanceof CompItem) return 'Comp';
  if (it instanceof FolderItem) return 'Folder';
  if (it instanceof FootageItem) return 'Footage';
  return 'Item';
}

function eveLayerType(l) {
  if (l instanceof ShapeLayer) return 'Shape';
  if (l instanceof TextLayer) return 'Text';
  if (l instanceof CameraLayer) return 'Camera';
  if (l instanceof LightLayer) return 'Light';
  return 'AV';
}

function eveFindComp(spec) {
  var p = app.project;
  if (spec === null || spec === undefined || spec === '') {
    var a = p.activeItem;
    return (a instanceof CompItem) ? a : null;
  }
  if (typeof spec === 'number') {
    var it = p.itemByID(spec);
    return (it instanceof CompItem) ? it : null;
  }
  for (var i = 1; i <= p.numItems; i++) {
    var x = p.item(i);
    if (x instanceof CompItem && x.name === spec) return x;
  }
  return null;
}

// Runs Claude's code inside one undo group. Code should be an expression or IIFE.
function eveExec(code, label) {
  var out = { ok: true };
  app.beginUndoGroup('Eve: ' + (label || 'script'));
  try {
    var r = eval(code);
    out.result = eveSafeVal(r);
  } catch (e) {
    out.ok = false;
    out.message = e.toString();
    out.line = e.line;
    out.name = e.name;
  }
  try { app.endUndoGroup(); } catch (e2) {}
  return eveJson(out);
}

function evePrefOk() {
  try {
    return app.preferences.getPrefAsLong('Main Pref Section', 'Pref_SCRIPTING_FILE_NETWORK_SECURITY') === 1 ? '1' : '0';
  } catch (e) { return '0'; }
}

function eveProjectInfo() {
  return eveTry(function () {
    var p = app.project;
    var o = { ok: true, saved: !!p.file, path: p.file ? p.file.fsName : null, name: p.file ? p.file.name : null,
      numItems: p.numItems, aeVersion: app.version, items: [] };
    for (var i = 1; i <= p.numItems && i <= 200; i++) {
      var it = p.item(i);
      o.items.push({ id: it.id, name: it.name, type: eveItemType(it), folder: it.parentFolder ? it.parentFolder.name : null });
    }
    var a = p.activeItem;
    o.active = a ? { id: a.id, name: a.name, type: eveItemType(a) } : null;
    return o;
  });
}

function eveSave() {
  return eveTry(function () {
    if (!app.project.file) return { ok: false, message: 'Project has not been saved yet.' };
    app.project.save();
    return { ok: true, path: app.project.file.fsName };
  });
}

function eveRestore(orig, cp) {
  return eveTry(function () {
    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    app.open(new File(cp));
    app.project.save(new File(orig));
    return { ok: true };
  });
}

function eveInspectComp(spec) {
  return eveTry(function () {
    var c = eveFindComp(spec);
    if (!c) return { ok: false, message: 'Composition not found (no active comp, or name/id does not match).' };
    var o = { ok: true, id: c.id, name: c.name, width: c.width, height: c.height, duration: c.duration,
      frameRate: c.frameRate, time: c.time, numLayers: c.numLayers, layers: [] };
    for (var i = 1; i <= c.numLayers; i++) {
      var l = c.layer(i);
      var e = { index: l.index, name: l.name, type: eveLayerType(l), enabled: l.enabled, solo: l.solo, shy: l.shy,
        locked: l.locked, label: l.label, inPoint: l.inPoint, outPoint: l.outPoint, startTime: l.startTime,
        parent: l.parent ? l.parent.index : null };
      try { e.effects = l.property('ADBE Effect Parade').numProperties; } catch (x) {}
      if (l instanceof AVLayer) {
        e.threeD = l.threeDLayer;
        try { e.source = l.source ? l.source.name : null; } catch (y) {}
      }
      o.layers.push(e);
    }
    return o;
  });
}

function eveWalk(g, depth, out, ctr) {
  for (var i = 1; i <= g.numProperties; i++) {
    if (ctr.n > 400) return;
    var p = g.property(i);
    ctr.n++;
    var e = { name: p.name, matchName: p.matchName };
    if (p.propertyType === PropertyType.PROPERTY) {
      try { if (p.canSetExpression && p.expressionEnabled) e.expression = p.expression; } catch (a) {}
      try { if (p.numKeys > 0) e.keys = p.numKeys; } catch (b) {}
      try {
        if (p.propertyValueType !== PropertyValueType.NO_VALUE && p.propertyValueType !== PropertyValueType.CUSTOM_VALUE) {
          e.value = eveSafeVal(p.value);
        }
      } catch (c) {}
    } else {
      e.children = [];
      if (depth < 6) eveWalk(p, depth + 1, e.children, ctr);
    }
    out.push(e);
  }
}

function eveInspectLayer(spec, idx) {
  return eveTry(function () {
    var c = eveFindComp(spec);
    if (!c) return { ok: false, message: 'Composition not found.' };
    var l = c.layer(idx);
    var o = { ok: true, comp: c.name, index: l.index, name: l.name, type: eveLayerType(l), properties: [] };
    eveWalk(l, 0, o.properties, { n: 0 });
    return o;
  });
}

function eveFrame(spec, time, path) {
  return eveTry(function () {
    var c = eveFindComp(spec);
    if (!c) return { ok: false, message: 'Composition not found.' };
    if (typeof c.saveFrameToPng !== 'function') return { ok: false, message: 'This After Effects version cannot save a frame from a script (saveFrameToPng missing).' };
    var t = (time === null || time === undefined) ? c.time : time;
    c.saveFrameToPng(t, new File(path));
    return { ok: true, comp: c.name, time: t };
  });
}
