const CoreProtocol = require("../core/client");

module.exports = class MeshClient extends CoreProtocol {
	constructor() {
		super();
		this.nameMaxLength = 16;
	}

	sendMessage(to, user, content) {
		this.send(to, JSON.stringify({user, content}));
	}

	onReceiveChat(from, timeSent, content) {
		content = JSON.parse(content);
		this.emit("message", from, timeSent, content.user, content.content);
	}
}