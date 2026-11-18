function appFile_() {
  var names = ['Untitled', 'Index', 'index', 'Index(Google)'];
  for (var i = 0; i < names.length; i++) {
    try {
      return HtmlService.createHtmlOutputFromFile(names[i]);
    } catch (e) {}
  }
  return HtmlService.createHtmlOutput('<h2>No HTML file found</h2><p>Add an HTML file named <b>Untitled</b> or <b>Index</b>.</p>');
}

// Called by the launcher: returns the site's HTML as text
function getAppHtml() {
  return appFile_().getContent();
}

// Sets the tab icon. Wrapped so a bad icon can never break the page.
function withIcon_(output) {
  try {
    output.setFaviconUrl('https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png');
  } catch (e) {}
  return output;
}

function launcherHtml_() {
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>',
    'html,body{margin:0;height:100%}',
    'body{background:#050a12;color:#e4edf7;font-family:Bahnschrift,Segoe UI,system-ui,sans-serif;display:grid;place-items:center;overflow:hidden;',
    'background-image:radial-gradient(900px 500px at 78% -10%,rgba(61,224,255,.18),transparent),radial-gradient(700px 420px at 10% 110%,rgba(111,123,255,.14),transparent),linear-gradient(#1c2c45 1px,transparent 1px),linear-gradient(90deg,#1c2c45 1px,transparent 1px);',
    'background-size:auto,auto,64px 64px,64px 64px}',
    'body:before{content:"";position:fixed;inset:0;background:linear-gradient(transparent 50%,rgba(0,0,0,.14) 50%);background-size:100% 4px;pointer-events:none;opacity:.4}',
    '.card{position:relative;width:min(420px,92vw);padding:42px 30px 30px;border:1px solid #1c2c45;border-radius:18px;background:rgba(11,20,34,.92);',
    'box-shadow:0 24px 80px rgba(0,0,0,.6),0 0 60px rgba(61,224,255,.07);text-align:center;animation:rise .6s ease both}',
    '.card:before{content:"";position:absolute;left:24px;right:24px;top:0;height:2px;background:linear-gradient(90deg,transparent,#3de0ff,#6f7bff,transparent);border-radius:2px}',
    '.brand{font-size:52px;font-weight:800;letter-spacing:-1.5px;line-height:1}',
    '.brand span{color:#3de0ff;text-shadow:0 0 24px rgba(61,224,255,.45)}',
    '.tag{color:#8196b0;margin:10px 0 30px;font-size:12px;letter-spacing:.28em;text-transform:uppercase}',
    '#go{width:100%;padding:16px 24px;font:inherit;font-size:18px;font-weight:700;letter-spacing:.5px;border:0;border-radius:12px;cursor:pointer;',
    'color:#04101a;background:linear-gradient(135deg,#3de0ff,#6f7bff);box-shadow:0 8px 30px rgba(61,224,255,.28);transition:transform .15s,box-shadow .15s}',
    '#go:hover{transform:translateY(-2px);box-shadow:0 12px 38px rgba(61,224,255,.42)}',
    '#go:active{transform:translateY(0)}',
    '#go:disabled{opacity:.75;cursor:wait;transform:none}',
    '#go:focus-visible{outline:2px solid #3de0ff;outline-offset:3px}',
    '.msg{min-height:20px;margin:18px 0 0;font-size:13px;color:#8196b0}',
    '.msg.err{color:#ff8585}',
    '.foot{margin-top:20px;padding-top:16px;border-top:1px solid #1c2c45;font-size:12px;color:#5b6f8a}',
    '.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#4dffb0;margin-right:7px;box-shadow:0 0 10px #4dffb0;animation:pulse 2s infinite}',
    '@keyframes pulse{50%{opacity:.35}}',
    '@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
    '@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}',
    '</style></head><body>',
    '<div class="card">',
    '<div class="brand">Sub<span>level</span></div>',
    '<div class="tag">Game distribution network</div>',
    '<button id="go" type="button">Open</button>',
    '<p id="msg" class="msg" role="status" aria-live="polite"></p>',
    '<div class="foot"><span class="dot"></span>Opens in a new tab. Allow pop-ups if asked.</div>',
    '</div>',
    '<script>',
    'var btn=document.getElementById("go"),msg=document.getElementById("msg");',
    'function say(t,err){msg.textContent=t;msg.className="msg"+(err?" err":"")}',
    'function reset(){btn.disabled=false;btn.textContent="Open"}',
    'var LOADING="<body style=\'margin:0;height:100vh;display:grid;place-items:center;background:#050a12;color:#8196b0;font-family:system-ui,sans-serif\'><div style=\'text-align:center\'><div style=\'font-size:40px;font-weight:800;color:#e4edf7\'>Sub<span style=\'color:#3de0ff\'>level</span></div><p style=\'letter-spacing:.2em;text-transform:uppercase;font-size:12px\'>Loading</p></div></body>";',
    'btn.onclick=function(){',
    ' var w=window.open("about:blank","_blank");',
    ' if(!w){say("Pop-up blocked. Allow pop-ups for this page, then click again.",true);return}',
    ' try{w.document.open();w.document.write(LOADING);w.document.close();w.document.title="My Drive - Google Drive"}catch(e){}',
    ' btn.disabled=true;btn.textContent="Opening...";say("Loading the archive...");',
    ' google.script.run',
    '  .withSuccessHandler(function(page){',
    '   w.document.open();w.document.write(page);w.document.close();',
    '   try{w.document.title="My Drive - Google Drive";var ic=w.document.createElement("link");ic.rel="icon";ic.href="https://www.google.com/s2/favicons?domain=drive.google.com&sz=64";w.document.head.appendChild(ic)}catch(err){}',
    '   say("");reset();',
    '   try{window.top.location.replace("https://www.google.com/")}catch(err){}',
    '  })',
    '  .withFailureHandler(function(err){say("Could not load: "+(err&&err.message||err),true);reset();try{w.close()}catch(x){}})',
    '  .getAppHtml();',
    '};',
    '</script></body></html>'
  ].join('\n');
}

function doGet(e) {
  // Direct (uncloaked) version of the site: add ?app=1 to the web app URL
  if (e && e.parameter && e.parameter.app) {
    return withIcon_(
      appFile_()
        .setTitle('My Drive - Google Drive')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    );
  }

  return withIcon_(
    HtmlService.createHtmlOutput(launcherHtml_())
      .setTitle('Sublevel')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
  );
}
