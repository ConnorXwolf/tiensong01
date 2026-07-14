import fs from 'fs';
const config = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));
const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;
console.log("Fetching:", url);
fetch(url)
  .then(res => res.text())
  .then(data => console.log(data.substring(0, 500)))
  .catch(err => console.error(err));
