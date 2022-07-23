'use strict';

/*
 * Created with @iobroker/create-adapter v2.0.2
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const vds = require('./lib/vds2465server.js');
const vdsmeldungen = require('./lib/vds2465.json');


// Load your modules here, e.g.:
const net = require('net');

let servertcp; // Server instance TCP
let isCreateStructur = false;
let isChangeConnect = false;
let queueConnect = [];
let devicesConnected = [];

class Vds2465Server extends utils.Adapter {
	
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: 'vds2465-server',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		// this.on('objectChange', this.onObjectChange.bind(this));
		this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));
		this.sendCommand.bind(this);
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here

		// Reset the connection indicator during startup
		this.setState('info.connection', false, true);

		// The adapters config (in the instance object everything under the attribute "native") is accessible via
		// this.config:
		let channel;
		try {
			for (let i = 0; i < this.config.relais.length; i++) {
				// @ts-ignore
				await this.grundstrukturAnlegen(this.config.relais[i].identnr);
				// @ts-ignore
				channel = await this.linieAnlegen(this.config.relais[i].identnr, this.config.relais[i].adr, this.config.relais[i].ge, this.config.relais[i].be, 0, 'Ausgang');
				this.log.info('Relais: ' + channel + ' durch Konfiguration angelegt');
			}
		}
		catch (e) {
			this.log.error(e + ' in onReady()');
        }
	
		/*
		For every state in the system there has to be also an object of type state
		Here a simple template for a boolean variable named "testVariable"
		Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
		*//*
		await this.setObjectNotExistsAsync('testVariable', {
			type: 'state',
			common: {
				name: 'testVariable',
				type: 'string',
				role: 'indicator',
				read: true,
				write: true,
			},
			native: {},
		});

		// In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
		this.subscribeStates('testVariable');
		// You can also add a subscription for multiple states. The following line watches all states starting with "lights."
		// this.subscribeStates('lights.*');
		// Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
		*/
		this.subscribeStates('*.abfrage');
		this.subscribeStates('*.ausgangszustand');

		/*
			setState examples
			you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
		*//*
		// the variable testVariable is set to true as command (ack=false)
		await this.setStateAsync('testVariable', 'true');

		// same thing, but the value is flagged "ack"
		// ack should be always set to true if the value is received from or acknowledged from the target system
		await this.setStateAsync('testVariable', { val: 'true', ack: true });

		// same thing, but the state is deleted after 30s (getState will return null afterwards)
		await this.setStateAsync('testVariable', { val: 'true', ack: true, expire: 30 });

		// examples for the checkPassword/checkGroup functions
		let result = await this.checkPasswordAsync('admin', 'iobroker');
		this.log.info('check user admin pw iobroker: ' + result);

		result = await this.checkGroupAsync('admin', 'administrator');
		this.log.info('check group user admin group administrator: ' + result);
		*/
		this.serverStart();
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			// clearTimeout(timeout1);
			// clearTimeout(timeout2);
			// ...
			// clearInterval(interval1);
			if (servertcp) {
				servertcp.close();
				this.setState('info.connection', false, true);
				while (devicesConnected.length > 0) {
					let obj = devicesConnected.shift();
					//this.setConnectState(obj.id, false, null);
					obj.ae.disconnect();
                }
            }
			callback();
		} catch (e) {
			callback();
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	// /**
	//  * Is called if a subscribed object changes
	//  * @param {string} id
	//  * @param {ioBroker.Object | null | undefined} obj
	//  */
	// onObjectChange(id, obj) {
	// 	if (obj) {
	// 		// The object was changed
	// 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
	// 	} else {
	// 		// The object was deleted
	// 		this.log.info(`object ${id} deleted`);
	// 	}
	// }

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (state) {
			// The state was changed
			if (!state.ack) {
				let tmp = id.split('.');
				tmp.pop();
				let channelid = tmp.join('.');
				this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
				if (id.indexOf('.abfrage') > 0) {
					this.getObject(id, (err, obj) => {
						if (err) {
							// @ts-ignore
							this.log.debug(err);
						} else {
							//this.log.debug(JSON.stringify(obj));
							if (obj && obj.native.hasOwnProperty('status')) {
								//this.log.debug(obj.native.status);
								this.sendCommand(channelid, obj.native.status);
							}
						}
					});
				} else if (id.indexOf('.ausgangszustand') > 0) {
					this.getObject(id, (err, obj) => {
						if (err) {
							// @ts-ignore
							this.log.debug(err);
						} else {
							if (obj && obj.native.hasOwnProperty('ein') && state.val) {
								//this.log.debug(obj.native.ein);
								this.sendCommand(channelid, obj.native.ein);
							} else if (obj && obj.native.hasOwnProperty('aus') && !state.val) {
								//this.log.debug(obj.native.aus);
								this.sendCommand(channelid, obj.native.aus);
							}
						}
					});
				}
			}
		} else {
			// The state was deleted
			this.log.debug(`state ${id} deleted`);
		}
	}

	//If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	/**
	* Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	* Using this method requires "common.messagebox" property to be set to true in io-package.json
	* @param {ioBroker.Message} obj
	*/
	onMessage(obj) {
		if (typeof obj === 'object' && obj.message) {
	 		if (obj.command === 'send') {
	 			// e.g. send email or pushover or whatever
	 			this.log.debug('send command');

	 			// Send response in callback if required
	 			//if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
	 		}
	 	}
	}
	
	/**
	* start socket server for listining
	*/
	serverStart() {
		servertcp = net.createServer(this.onClientConnected.bind(this));
		servertcp.listen(this.config.bindPort, this.config.bindIP, () => {
			let text = 'Server listening on IP-Adress (TCP): ' + servertcp.address().address + ':' + servertcp.address().port;
			this.log.info(text);
			this.setState('info.connection', true, true);
		});
		servertcp.on('error', (e) => {
			this.log.error(e.message);
		});
	}
	
	/**
	* alarm system connected (TCP/IP)
	* @param {net.Socket} sock - socket
	*/
	onClientConnected(sock) {
		let remoteAddress = sock.remoteAddress + ':' + sock.remotePort;
		const AE = new vds();

		AE.on('log', (msg, level) => {
			switch (level) {
				case 'debug': this.log.debug('AE: ' + msg);
					break;
				case 'warn': this.log.warn('AE: ' + msg);
					break;
				case 'error': this.log.error('AE: ' + msg);
					break;
				default: this.log.info('AE: ' + msg);
			}
		});

		AE.on('connect', (id) => {
			this.log.debug('connect ID: ' + id);
			this.setConnectState(id, true, AE);
		})

		AE.on('disconnect', (id) => {
			this.log.debug('disconnect ID: ' + id.toString());
			this.setConnectState(id, false, AE);
		})

		AE.on('data', (obj) => {
			if (obj && typeof obj === 'object') {
				this.log.debug('Daten von: ' + AE.Identnummer);
				this.zerlegeDaten(AE.Identnummer === '' ? 'unbekannt' : AE.Identnummer, obj);
            }
		});

		AE.setLogLevel(this.log.level);
		AE.Polling = this.config.poolIntervall;
		if (this.config.devices.length > 0) {
			this.config.devices.forEach((obj) => {
				try {
					// @ts-ignore
					AE.addDevice(obj.identnr, obj.stehend, obj.keynr, obj.key);
				}
				catch (e) {
					this.log.error('Setzen Geraetedaten nicht möglich');
                }
			});
		}

		AE.connect(sock);

		sock.on('data', (data) => {
			//this.log.info('received from ' + remoteAddress + ' following data: ' + JSON.stringify(data));
			AE.received(data);
		});
		sock.on('close', () => {
			this.log.info('connection from ' + remoteAddress + ' closed');
			AE.disconnect();
		});
		sock.on('error', (err) => {
			this.log.error('Connection ' + remoteAddress + ' error: ' + err.message);
		});
	}

	/**
	* Setzt den Verbindungszustand und speichert die Verweise
	* @param {String} id Identnummer
	* @param {Boolean} state Zustand
    * @param {vds | null} AE Verwalter
	*/
	async setConnectState(id, state, AE) {
		try {
			queueConnect.push({ 'id': id, 'state': state, 'ae': AE , 'command': []});
			if (isChangeConnect) {
				return;
			}
			isChangeConnect = true;
			let obj;
			while (queueConnect.length > 0) {
				obj = queueConnect.shift();
				if (obj.state) {
					await this.grundstrukturAnlegen(obj.id);
					devicesConnected.push(obj);
				} else {
					let i;
					for (i = 0; i < devicesConnected.length; i++) {
						if (devicesConnected[i].id === obj.id) {
							devicesConnected.splice(i, 1);
							break;
						}
					}
				}
				await this.setStateAsync(`${obj.id}.Info.zustand`, obj.state, true);
			}
		}
		catch (e) {
			this.log.error('setConnectState: ' + e)
		}
		finally {
			isChangeConnect = false;
		}
	}

	/**
	* Setzt die States für Abfrage und Fehler nach einem Befehl
	* @param {String} channel ChannelID oder Identnummer
	* @param {String} meldung Fehlermeldung
    * @param {Number} satz Datensatz (0x03, 0x11 oder 0x20)
	*/
	async checkCommand(channel, meldung, satz) {
		let identnr;
		let isChannelIdentnr = false;
		if (channel.indexOf('.') >= 0) {
			identnr = (channel.split('.'))[2];
		} else {
			identnr = channel;
			isChannelIdentnr = true;
        }
		for (let i = 0; i < devicesConnected.length; i++) {
			if (devicesConnected[i].id === identnr) {
				for (let x = 0; x < devicesConnected[i].command.length; x++) {
					if (satz === 0x11) {
						await this.setStateAsync(devicesConnected[i].command[x].channelid + '.abfrage', false, true);
						await this.setStateAsync(devicesConnected[i].command[x].channelid + '.fehler', meldung, true);
						await this.setStateAsync(devicesConnected[i].command[x].channelid + '.zeit_empfang', '', true);
                    }
					devicesConnected[i].command.splice(x, 1);
					return;
                }
			}
		}
    }

	/**
	* Sendet den Befehl
	* @param {String} channelid Channel-Id
    * @param {String} command Vollständiger Satz (0x02 oder 0x10)
	*/
	async sendCommand(channelid, command) {
		let identnr = (channelid.split('.'))[2];
		this.log.debug(`Befehl: ${command} fuer id: ${identnr}`);
		for (let i = 0; i < devicesConnected.length; i++) {
			if (devicesConnected[i].id === identnr) {
				devicesConnected[i].command.push({ 'channelid': channelid, 'satz': command });
				devicesConnected[i].ae.sendCommand(command);
				return;
            }
		}
		await this.setStateAsync(channelid + '.abfrage', false, true);
		await this.setStateAsync(channelid + '.fehler', 'keine Verbindung', true);
		await this.setStateAsync(channelid + '.zeit_empfang', '', true);
    }

	/**
	* Legt die Grundstruktur an, wenn nicht vorhanden (Device)
	* @param {String} id Identnummer
	*/
	async grundstrukturAnlegen(id) {
		try {
			isCreateStructur = true;
			let dev = await this.getDevicesAsync();
			if (dev.length > 0) {
				//this.log.debug(JSON.stringify(dev));
				for (let i = 0; i < dev.length; i++) {
					if ((this.namespace + '.' + id) === dev[i]._id) {
						isCreateStructur = false;
						return;
                    }
                }
			}
			await this.createDeviceAsync(id, { "name": id });
			await this.createChannelAsync(id, 'Info', { "name": "Information" });
			await this.createStateAsync(id, 'Info', 'zustand', {
				"role": "indicator.connected",
				"name": "Verbindung steht",
				"type": "boolean",
				"read": true,
				"write": false,
				"def": false
			});
			await this.createStateAsync(id, 'Info', 'letzteTestmeldung', {
				"role": "info",
				"name": "Letzte Testmeldung",
				"type": "string",
				"read": true,
				"write": false,
				"def": ''
			});
			await this.createStateAsync(id, 'Info', 'hersteller', {
				"role": "info",
				"name": "Herstellerinfo",
				"type": "string",
				"read": true,
				"write": false,
				"def": ''
			});
			await this.createStateAsync(id, 'Info', 'merkmale', {
				"role": "info",
				"name": "Geraetemerkmale",
				"type": "string",
				"read": true,
				"write": false,
				"def": ''
			});
		} catch (e) {
			this.log.error(e);
		} finally{
			isCreateStructur = false;
        }
	}

	/**
	* Legt die Linien an, wenn nicht vorhanden (Channel und State)
	* @param {String} id Identnummer
    * @param {Number} li Adresse
    * @param {Number} ge Geraet
    * @param {Number} be Bereich
    * @param {Number} az Adresszusatz
    * @param {String} art Adresserweiterung
    * @return {Promise<String>} ID vom State 
	*/
	async linieAnlegen(id, li, ge, be, az, art) {
		let channel_id = `${id}.${art}_${li}-${ge}-${be}-${az}`;
		try {
			let obj = await this.getObjectAsync(channel_id);
			if (!obj) {
				let channel = `${art}_${li}-${ge}-${be}-${az}`;
				let name = `Li:${li} Ge:${ge} Be:${be} AdrZus:${az}`;
				let gebe = (ge << 4 & 0xF0) | (be & 0x0F);
				let Adresserweiterung;
				if (art === 'Stoerung') {
					switch (li) {
						case 1:
							await this.createChannelAsync(id, channel, { "name": "Unterspannung" });
							break;
						case 2:
							await this.createChannelAsync(id, channel, { "name": "Akkufehler" });
							break;
						case 3:
							await this.createChannelAsync(id, channel, { "name": "Netzfehler" });
							break;
						case 17:
							await this.createChannelAsync(id, channel, { "name": "Fehler Uebertragungs-Primaerweg" });
							break;
						case 18:
							await this.createChannelAsync(id, channel, { "name": "Fehler Uebertragungs-Ersatzweg" });
							break;
						default:
							await this.createChannelAsync(id, channel);
							break;
					}

				} else {
					await this.createChannelAsync(id, channel, { "name": name });
				}
				switch (art) {
					case 'Eingang':
						Adresserweiterung = 1;
						await this.createStateAsync(id, channel, 'meldungszustand', {
							"role": "indicator.state",
							"name": "Meldungszustand",
							"type": "boolean",
							"read": true,
							"write": false,
							"def": false,
							"states": {
								"true": "Ein",
								"false": "Aus"
							}
						});
						await this.createStateAsync(id, channel, 'meldungsart', {
							"role": "value",
							"name": "Meldungsart",
							"type": "number",
							"read": true,
							"write": false,
							"def": 128
						});
						await this.createStateAsync(id, channel, 'meldungVds', {
							"role": "value",
							"name": "Text",
							"type": "string",
							"read": true,
							"write": false,
							"def": ''
						});
						await this.createStateAsync(id, channel, 'text', {
							"role": "value",
							"name": "Text zur Meldung",
							"type": "string",
							"read": true,
							"write": false,
							"def": ''
						});
						await this.createStateAsync(id, channel, 'zeit_meldung', {
							"role": "datetime",
							"name": "Zeitpunkt der Ausloesung",
							"type": "string",
							"read": true,
							"write": false,
							"def": ''
						});
						await this.createStateAsync(id, channel, 'zeit_empfang', {
							"role": "datetime",
							"name": "Zeitpunkt des Empfangs",
							"type": "string",
							"read": true,
							"write": false,
							"def": ''
						});
						await this.createStateAsync(id, channel, 'weg', {
							"role": "value",
							"name": "Uebertragungsweg",
							"type": "string",
							"read": true,
							"write": false,
							"def": ''
						});
						await this.createStateAsync(id, channel, 'fehler', {
							"role": "info",
							"name": "Fehlermeldung",
							"type": "string",
							"read": true,
							"write": false,
							"def": ''
						});
						await this.createStateAsync(id, channel, 'abfrage', {
							"role": "button",
							"name": "Abfrage des Zustands",
							"type": "boolean",
							"read": true,
							"write": true,
							"def": false
						}, {
							"status": Buffer.from([5, 0x10, gebe, li, az, Adresserweiterung, 0x20]).toString('hex')
						});
						break;
					case 'Ausgang':
						Adresserweiterung = 2;
						await this.createStateAsync(id, channel, 'ausgangszustand', {
							"role": "indicator.state",
							"name": "Ausgangszustand",
							"type": "boolean",
							"read": true,
							"write": true,
							"def": false,
							"states": {
								"true": "Ein",
								"false": "Aus"
							}
						}, {
							"ein": Buffer.from([5, 2, gebe, li, az, Adresserweiterung, 0]).toString('hex'),
							"aus": Buffer.from([5, 2, gebe, li, az, Adresserweiterung, 128]).toString('hex'),
						});
						await this.createStateAsync(id, channel, 'zeit_empfang', {
							"role": "datetime",
							"name": "Zeitpunkt des Empfangs",
							"type": "string",
							"read": true,
							"write": false,
							"def": ''
						});
						await this.createStateAsync(id, channel, 'fehler', {
							"role": "info",
							"name": "Fehlermeldung",
							"type": "string",
							"read": true,
							"write": false,
							"def": ''
						});
						await this.createStateAsync(id, channel, 'abfrage', {
							"role": "button",
							"name": "Abfrage des Zustands",
							"type": "boolean",
							"read": true,
							"write": true,
							"def": false
						}, {
							"status": Buffer.from([5, 0x10, gebe, li, az, Adresserweiterung, 0x20]).toString('hex')
						});
						break;
					case 'Stoerung':
						Adresserweiterung = 0x10;
						await this.createStateAsync(id, channel, 'meldungszustand', {
							"role": "indicator.state",
							"name": "Meldungszustand",
							"type": "boolean",
							"read": true,
							"write": false,
							"def": false,
							"states": {
								"true": "Ein",
								"false": "Aus"
							}
						});
						await this.createStateAsync(id, channel, 'meldungsart', {
							"role": "value",
							"name": "Meldungsart",
							"type": "number",
							"read": true,
							"write": false,
							"def": 128
						});
						await this.createStateAsync(id, channel, 'meldungVds', {
							"role": "value",
							"name": "Text",
							"type": "string",
							"read": true,
							"write": false,
							"def": ''
						});
						await this.createStateAsync(id, channel, 'text', {
							"role": "value",
							"name": "Text",
							"type": "string",
							"read": true,
							"write": false,
							"def": ''
						});
						await this.createStateAsync(id, channel, 'zeit_meldung', {
							"role": "datetime",
							"name": "Zeitpunkt der Ausloesung",
							"type": "string",
							"read": true,
							"write": false,
							"def": ''
						});
						await this.createStateAsync(id, channel, 'zeit_empfang', {
							"role": "datetime",
							"name": "Zeitpunkt des Empfangs",
							"type": "string",
							"read": true,
							"write": false,
							"def": ''
						});
						await this.createStateAsync(id, channel, 'fehler', {
							"role": "info",
							"name": "Fehlermeldung",
							"type": "string",
							"read": true,
							"write": false,
							"def": ''
						});
						await this.createStateAsync(id, channel, 'abfrage', {
							"role": "button",
							"name": "Abfrage des Zustands",
							"type": "boolean",
							"read": true,
							"write": true,
							"def": false
						}, {
							"status": Buffer.from([5, 0x10, gebe, li, az, Adresserweiterung, 0x20]).toString('hex')
						});
						break;
				}
			}
		}
		catch (e) {
			this.log.error('linieAnlegen: ' + e);
		}
		finally {
			return channel_id;
        }
    }

	Sleep(milliseconds) {
		return new Promise(resolve => setTimeout(resolve, milliseconds));
	}

	/**
	* Empfangene Daten
    * @param {String} id Identnummer
	* @param {Object} obj Daten als JSON
	*/
	async zerlegeDaten(id, obj) {
		let channel = '';
		try {
			let date = new Date();
			let zeit = date.toLocaleString('de-DE');
			while (isCreateStructur) {
				await this.Sleep(100);
			}
			let Meldungszeit = '';
			if (obj.hasOwnProperty('Satz_50')) {
				let zeit = new Date(obj['Satz_50'].Value);
				Meldungszeit = zeit.toLocaleString('de-DE');
			}
			if (obj.hasOwnProperty('Satz_2') || obj.hasOwnProperty('Satz_3') || obj.hasOwnProperty('Satz_4') || obj.hasOwnProperty('Satz_20')) {
				let satz = 'Satz_2';
				if (obj.hasOwnProperty('Satz_3')) {
					satz = 'Satz_3';
				} else if (obj.hasOwnProperty('Satz_4')) {
					satz = 'Satz_4';
				} else if (obj.hasOwnProperty('Satz_20')) {
					satz = 'Satz_20';
				}
				channel = await this.linieAnlegen(id, obj[satz].Adresse, obj[satz].Geraet, obj[satz].Bereich, obj[satz].Adresszusatz, obj[satz].Adresserweiterung);
				let name = vdsmeldungen[obj[satz].Meldungsart];
				if (typeof name === 'undefined') {
					name = '';
                }
				if (obj[satz].Adresserweiterung === 'Eingang') {
					await this.setStateAsync(channel + '.abfrage', false, true);
					await this.setStateAsync(channel + '.fehler', '', true);
					await this.setStateAsync(channel + '.meldungszustand', obj[satz].Meldungsart < 128 ? true : false, true);
					await this.setStateAsync(channel + '.meldungsart', obj[satz].Meldungsart, true);
					await this.setStateAsync(channel + '.meldungVds', name, true);
					await this.setStateAsync(channel + '.text', obj.hasOwnProperty('Satz_54') ? obj['Satz_54'].Value : '', true);
					await this.setStateAsync(channel + '.zeit_meldung', Meldungszeit, true);
					await this.setStateAsync(channel + '.zeit_empfang', zeit, true);
					await this.setStateAsync(channel + '.weg', obj.hasOwnProperty('Satz_61') ? obj['Satz_61'].Value : '', true);
				} else if (obj[satz].Adresserweiterung === 'Ausgang') {
					await this.setStateAsync(channel + '.ausgangszustand', obj[satz].Meldungsart < 128 ? true : false, true);
					await this.setStateAsync(channel + '.zeit_empfang', zeit, true);
					await this.setStateAsync(channel + '.abfrage', false, true);
					await this.setStateAsync(channel + '.fehler', '', true);
				} else {
					await this.setStateAsync(channel + '.meldungszustand', obj[satz].Meldungsart < 128 ? true : false, true);
					await this.setStateAsync(channel + '.meldungsart', obj[satz].Meldungsart, true);
					await this.setStateAsync(channel + '.text', obj.hasOwnProperty('Satz_54') ? obj['Satz_54'].Value : '', true);
					await this.setStateAsync(channel + '.zeit_meldung', Meldungszeit, true);
					await this.setStateAsync(channel + '.zeit_empfang', zeit, true);
					await this.setStateAsync(channel + '.abfrage', false, true);
					await this.setStateAsync(channel + '.fehler', '', true);
                }
			}
			if (obj.hasOwnProperty('Satz_3')) {
				await this.checkCommand(channel, '', 0x03);
			}
			if (obj.hasOwnProperty('Satz_11')) {
				await this.checkCommand(id, obj['Satz_11'].Value, 0x11);
			}
			if (obj.hasOwnProperty('Satz_20')) {
				await this.checkCommand(channel, '', 0x20);
			}
			if (obj.hasOwnProperty('Satz_40')) {
				await this.setStateAsync(`${id}.Info.letzteTestmeldung`, zeit, true);
			}
			if (obj.hasOwnProperty('Satz_51')) {
				await this.setStateAsync(`${id}.Info.hersteller`, obj['Satz_51'].Value, true);
			}
			if (obj.hasOwnProperty('Satz_59')) {
				await this.setStateAsync(`${id}.Info.merkmale`, obj['Satz_59'].Value, true);
			}
		} catch (e) {
			this.log.error('zerlegeDaten: ' + e);
		}
    }
}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new Vds2465Server(options);
} else {
	// otherwise start the instance directly
	new Vds2465Server();
}