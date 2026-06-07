const fs = require('fs');
let appJs = fs.readFileSync('app.js', 'utf8');

// Replace card link
appJs = appJs.replace(/card\.href = project\.url;/, "card.href = '/project/' + project.id + '/';");

// Remove WEB_PROJECTS hardcoded array
const webProjectsRegex = /const WEB_PROJECTS = \[[\s\S]*?\];/;
appJs = appJs.replace(webProjectsRegex, 'let WEB_PROJECTS = [];');

// Add fetch
const fetchLogic = `async function fetchProjects() {
  try {
    const res = await fetch('/projects.json');
    WEB_PROJECTS = await res.json();
    filteredWebProjects = [...WEB_PROJECTS];
  } catch (e) {
    console.error('Failed to load projects.json', e);
  }
}

function initProjects() {`;

appJs = appJs.replace(/function initProjects\(\) \{/, fetchLogic);

// Call fetchProjects before initProjects
// Wait, initProjects is called synchronously right now in DOMContentLoaded, but now we need to await it.
// The main DOMContentLoaded handler looks like:
// document.addEventListener('DOMContentLoaded', async () => {
// Let's check how initProjects is called. It's inside a DOMContentLoaded listener, but the listener might not be async.
// Let's replace `initProjects();` with `fetchProjects().then(initProjects);`
appJs = appJs.replace(/initProjects\(\);/, 'fetchProjects().then(initProjects);');

fs.writeFileSync('app.js', appJs);
console.log('Updated app.js');
