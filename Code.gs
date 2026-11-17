/**
 * Sublevel Apps Script web-app entry point.
 * Deploy this Apps Script project as a Web app.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Sublevel');
}
