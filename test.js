const readline = require("readline");

const blank = "\n".repeat(process.stdout.rows)
console.log(blank)
readline.cursorTo(process.stdout, 0, 0)
readline.clearScreenDown(process.stdout)

let i = 1;

// console.log("#".repeat(i));
console.log(process.stdout.columns+"x"+process.stdout.rows);

// setInterval(() => {
// 	i++;
// 	readline.cursorTo(process.stdout, 0)
// 	readline.moveCursor(process.stdout, 0, -1);
// 	readline.cursorTo(process.stdout);
// 	console.log("#".repeat(i));
// }, 500);