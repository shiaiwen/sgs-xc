const fs = require("fs");
const p = "C:\\Users\\24745\\terminals\\53551.txt";
const text = fs.readFileSync(p, "utf8");
console.log(text);
console.log("----- length=" + text.length + " -----");
