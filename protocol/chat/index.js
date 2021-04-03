const CoreProtocol = require("../core/client");

module.exports = class MeshClient extends CoreProtocol {
	constructor() {
		super();

		this.nameMaxLength = 16;
	}
}