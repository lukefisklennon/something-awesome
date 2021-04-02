const readline = require("readline");
const {table, getBorderCharacters} = require("table");
require("colors");

const shell = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const users = [];

const welcomeText = "Type \"help\" for a list of commands.";

const commands = {
	"help": () => {
		return `Commands: ${Object.keys(commands).join(", ")}.`;
	},
	"add [user key]": (args) => {
		users.push({key: args[0], name: "Unknown".grey, color: null});
		return `Added user with key "${args[0]}".`;
	},
	"remove [user #]": (args) => {
		users.splice(Number(args[0]) - 1, 1);
		return `Removed user #${args[0]}.`;
	},
	"chat [user #]": (args) => {

	}
};

const onInput = (input) => {
	const args = input.split(" ");

	for (let command in commands) {
		if (command.split(" ")[0] === args[0].toLowerCase()) {
			awaitInput(commands[command](args.slice(1)));
			return;
		}
	}

	awaitInput(`Unknown command "${args[0]}". ${welcomeText}`);
}

const listUsers = () => {
	let output;
	const config = {
		border: getBorderCharacters("norc"),
		drawHorizontalLine: (index, size) => [0, 1, size].includes(index)
	};

	if (users.length === 0) {
		config.columns = {0: {width: welcomeText.length - 4}};
		output = table([["No users added yet."]], config);
	} else {
		output = table([
			["#", "Name", "Key"],
			...users.map((user, index) => [index + 1, user.name, user.key])
		], config);
	}

	console.log(output.trim());
}

const clearScreen = () => {
	console.log("\n".repeat(process.stdout.rows));
	readline.cursorTo(process.stdout, 0, 0);
	readline.clearScreenDown(process.stdout);
}

// const clearLine = () => {
// 	readline.cursorTo(process.stdout, 0);
// 	readline.moveCursor(process.stdout, 0, -1);
// }

const awaitInput = (lastOutput) => {
	clearScreen();
	listUsers();
	console.log(lastOutput);
	shell.question("> ", onInput);
}

awaitInput(welcomeText);
