const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "src", "features", "authentication", "services", "authservice.ts");
let s = fs.readFileSync(file, "utf8");
const at = String.fromCharCode(64); // "@"
s = s.replace(
  "readStoredProfile(normalizedEmail;",
  "readStoredProfile(normalizedEmail);"
);
s = s.replace(
  `split(${at})[0;`,
  `split(${at})[0];`
);
fs.writeFileSync(file, s, "utf8");
console.log("refix fixed: readStoredProfile", s.includes("readStoredProfile(normalizedEmail);"));
console.log("refix fixed: split[0]", s.includes(`split(${at})[0];`));