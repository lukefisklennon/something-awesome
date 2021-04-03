module.exports = {
	dataDir: (
		process.env.APPDATA || (
			process.platform == "darwin"
			? process.env.HOME + "/Library/Preferences"
			: process.env.HOME + "/.local/share"
		)
	)
};
