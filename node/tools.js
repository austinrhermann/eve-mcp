// MCP tools Eve exposes to Claude. ctx: { ae, lit, state, ui }
const fs = require('fs'), os = require('os'), path = require('path');

async function waitForFile(file, ms) {
  const t0 = Date.now(); let last = -1;
  while (Date.now() - t0 < ms) {
    try { const sz = fs.statSync(file).size; if (sz > 0 && sz === last) return true; last = sz; } catch (e) { last = -1; }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

function text(t, isError) { return { content: [{ type: 'text', text: String(t).slice(0, 60000) }], isError: !!isError }; }

module.exports = function (ctx) {
  const { ae, lit, state, ui } = ctx;
  const compProp = { comp: { description: 'Composition name or numeric id. Omit for the active comp.' } };
  return [
    {
      name: 'execute_script',
      description: 'Run ExtendScript (ES3) inside After Effects as ONE undo step. Code is eval()ed: pass an expression or an IIFE like (function(){ ...; return value; })(). No arrow functions, let/const or template literals. Returns {ok,result} or {ok:false,message,line}.',
      inputSchema: { type: 'object', properties: { code: { type: 'string' }, label: { type: 'string', description: 'Short label for the undo step, e.g. "rename layers"' } }, required: ['code'] },
      async handler(a) {
        if (state.fails >= 3) return text('STOP: three scripts in a row failed. Explain the problem to the user and ask how to proceed.', true);
        const label = String(a.label || 'script');
        if (ui.manual && ui.manual()) { const ok = await ui.confirmScript({ label, code: a.code }); if (!ok) return text('The user declined to run this script. Ask what they would like instead.', false); }
        const r = await ae.json('eveExec(' + lit(String(a.code || '')) + ',' + lit(label) + ')');
        if (r.ok) state.fails = 0; else state.fails++;
        ui.onScript({ label, ok: !!r.ok, message: r.message, line: r.line, attempt: state.fails });
        return text(JSON.stringify(r), !r.ok);
      }
    },
    {
      name: 'get_project_info',
      description: 'Project path, After Effects version, the first 200 project items and the active item.',
      inputSchema: { type: 'object', properties: {} },
      async handler() { return text(JSON.stringify(await ae.json('eveProjectInfo()'))); }
    },
    {
      name: 'inspect_comp',
      description: 'Composition settings and a summary of every layer (name, type, label, in/out, parent, effects count).',
      inputSchema: { type: 'object', properties: compProp },
      async handler(a) { return text(JSON.stringify(await ae.json('eveInspectComp(' + lit(a.comp) + ')'))); }
    },
    {
      name: 'inspect_layer',
      description: 'Property tree of one layer: names, match names, values, expressions, keyframe counts.',
      inputSchema: { type: 'object', properties: Object.assign({ layer: { type: 'number', description: '1-based layer index' } }, compProp), required: ['layer'] },
      async handler(a) { return text(JSON.stringify(await ae.json('eveInspectLayer(' + lit(a.comp) + ',' + lit(a.layer) + ')'))); }
    },
    {
      name: 'see_frame',
      description: 'Render one frame of a composition to a PNG and return it as an image, to check your work visually.',
      inputSchema: { type: 'object', properties: Object.assign({ time: { type: 'number', description: 'Seconds. Omit for the current time.' } }, compProp) },
      async handler(a) {
        const file = path.join(os.tmpdir(), 'eve-frame-' + Date.now() + '.png');
        const fileFwd = file.replace(/\\/g, '/');
        const r = await ae.json('eveFrame(' + lit(a.comp) + ',' + lit(a.time) + ',' + lit(fileFwd) + ')');
        if (!r.ok) return text(JSON.stringify(r), true);
        const ready = await waitForFile(file, 20000);
        if (!ready) { try { fs.unlinkSync(file); } catch (e) {} return text('After Effects did not finish writing the frame (file stayed empty or missing for 20 s). The comp may be too heavy to render that fast. Try another time or a lighter comp. Do not assume a preferences problem.', true); }
        try {
          const data = fs.readFileSync(file).toString('base64');
          fs.unlinkSync(file);
          return { content: [{ type: 'image', data, mimeType: 'image/png' }, { type: 'text', text: 'Frame of "' + r.comp + '" at ' + r.time + 's' }] };
        } catch (e) { return text('Frame was not written. Is "Allow Scripts to Write Files" enabled?', true); }
      }
    },
    {
      name: 'approve',
      description: 'Internal permission prompt handler used by the panel.',
      inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name'] },
      async handler(a) {
        const allow = await ui.approve(a);
        return text(JSON.stringify(allow ? { behavior: 'allow', updatedInput: a.input || {} } : { behavior: 'deny', message: 'The user declined this action.' }));
      }
    }
  ];
};
