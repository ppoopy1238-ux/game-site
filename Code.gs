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

function doGet(e) {
  // Direct (uncloaked) version of the site: add ?app=1 to the web app URL
  if (e && e.parameter && e.parameter.app) {
    return appFile_()
      .setTitle('My Drive - Google Drive')
      .setFaviconUrl('https://www.google.com/s2/favicons?domain=drive.google.com&sz=64')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var html =
    '<body style="margin:0;height:100vh;display:grid;place-items:center;background:#050a12;font-family:sans-serif">' +
    '<div style="text-align:center">' +
    '<button id="go" style="padding:14px 28px;font-size:18px;font-weight:bold;border:0;border-radius:10px;background:#3de0ff;color:#04101a;cursor:pointer">Open</button>' +
    '<p id="msg" style="color:#8196b0;margin-top:14px"></p></div>' +
    '<script>' +
    'document.getElementById("go").onclick=function(){' +
    ' var msg=document.getElementById("msg");' +
    ' var w=window.open("about:blank","_blank");' +
    ' if(!w){msg.textContent="Pop-up blocked. Allow pop-ups for this page, then click again.";return}' +
    ' w.document.title="Loading...";' +
    ' msg.textContent="Loading...";' +
    ' google.script.run' +
    '  .withSuccessHandler(function(page){' +
    '   w.document.open();w.document.write(page);w.document.close();' +
    '   try{w.document.title="My Drive - Google Drive";var ic=w.document.createElement("link");ic.rel="icon";ic.href="https://www.google.com/s2/favicons?domain=drive.google.com&sz=64";w.document.head.appendChild(ic)}catch(err){}' +
    '   msg.textContent="";' +
    '   try{window.top.location.replace("https://www.google.com/")}catch(err){}' +
    '  })' +
    '  .withFailureHandler(function(err){msg.textContent="Could not load: "+(err&&err.message||err);try{w.close()}catch(x){}})' +
    '  .getAppHtml();' +
    '};' +
    '</script></body>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('Launcher')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function checkScripts() {
  var names = ['Untitled', 'Index', 'index', 'Index(Google)'];
  var html = null;
  for (var k = 0; k < names.length; k++) {
    try {
      html = HtmlService.createHtmlOutputFromFile(names[k]).getContent();
      Logger.log('Using file: ' + names[k]);
      break;
    } catch (e) {}
  }
  if (!html) { Logger.log('No HTML file found'); return; }

  Logger.log('File length: ' + html.length + ' chars');
  Logger.log('File ends with: ' + html.slice(-40).replace(/\n/g, ' '));

  var re = /<script[^>]*>([\s\S]*?)<\/script>/gi, m, i = 0;
  while ((m = re.exec(html))) {
    i++;
    var code = m[1];
    var start = code.trim().slice(0, 50).replace(/\s+/g, ' ');
    try {
      new Function(code);
      Logger.log('Script ' + i + ': OK (' + code.length + ' chars) starts: ' + start);
    } catch (err) {
      Logger.log('Script ' + i + ': SYNTAX ERROR: ' + err.message + ' (' + code.length + ' chars) starts: ' + start);
    }
  }
  Logger.log('Total script blocks: ' + i);
}
function findBadLine() {
  var names = ['Untitled', 'Index', 'index', 'Index(Google)'];
  var html = null;
  for (var k = 0; k < names.length; k++) {
    try { html = HtmlService.createHtmlOutputFromFile(names[k]).getContent(); break; } catch (e) {}
  }
  if (!html) { Logger.log('No HTML file found'); return; }

  var re = /<script[^>]*>([\s\S]*?)<\/script>/gi, m, i = 0;
  while ((m = re.exec(html))) {
    i++;
    var code = m[1];
    try { new Function(code); continue; } catch (e) {}

    var lines = code.split('\n'), chunk = '', startLine = 1;
    for (var n = 0; n < lines.length; n++) {
      chunk += (chunk ? '\n' : '') + lines[n];
      try { new Function(chunk); chunk = ''; startLine = n + 2; } catch (e) {}
    }
    Logger.log('Script ' + i + ': broken statement starts at line ' + startLine + ' of ' + lines.length);
    for (var j = startLine - 1; j < Math.min(startLine + 3, lines.length); j++) {
      var l = lines[j];
      Logger.log('L' + (j + 1) + ' (' + l.length + ' chars): ' + (l.length > 700 ? l.slice(0, 350) + ' ...... ' + l.slice(-350) : l));
    }
  }
}
