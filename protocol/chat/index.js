const CoreProtocol = require("../core/client");

module.exports = class ChatProtocol extends CoreProtocol {
	constructor() {
		super();

		this.nameMaxLength = 16;
	}
}