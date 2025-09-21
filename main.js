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
let isChangeConnect = false;
const queueConnect = [];
const devicesConnected = [];

class Vds2465Server extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options] Adapteroptionen
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
        //this.sendCommand.bind(this);
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        // Reset the connection indicator during startup
        this.setState('info.connection', false, true);

        // The adapters config (in the instance object everything under the attribute "native") is accessible via
        let channel;
        try {
            for (let i = 0; i < this.config.relais.length; i++) {
                // @ts-expect-error identnr
                const id = this.config.relais[i].identnr.toString();
                await this.grundstrukturAnlegen(id);
                // @ts-expect-error adr ge und be
                channel = await this.linieAnlegen(
                    id,
                    this.config.relais[i].adr,
                    this.config.relais[i].ge,
                    this.config.relais[i].be,
                    0,
                    'Ausgang',
                );
                this.log.info(`Relais: ${channel} durch Konfiguration angelegt`);
            }
        } catch (e) {
            this.log.error(`${e} in onReady()`);
        }

        /*
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
		*/
        this.subscribeStates('*.abfrage');
        this.subscribeStates('*.ausgangszustand');

        this.serverStart();
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param {() => void} callback Callbackfunktion
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
                    const obj = devicesConnected.shift();
                    //this.setConnectState(obj.id, false, null);
                    obj.ae.disconnect();
                }
            }
            callback();
        } catch (e) {
            this.log.error(`onUnload error ${e}`);
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
     *
     * @param {string} id Identnummer
     * @param {ioBroker.State | null | undefined} state Status
     */
    onStateChange(id, state) {
        if (state) {
            // The state was changed
            if (!state.ack) {
                const tmp = id.split('.');
                tmp.pop();
                const channelid = tmp.join('.');
                this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
                if (id.indexOf('.abfrage') > 0) {
                    this.getObject(id, (err, obj) => {
                        if (err) {
                            this.log.debug(err.toString());
                        } else {
                            //this.log.debug(JSON.stringify(obj));
                            if (obj && Object.prototype.hasOwnProperty.call(obj.native, 'status')) {
                                //this.log.debug(obj.native.status);
                                this.sendCommand(channelid, obj.native.status);
                            }
                        }
                    });
                } else if (id.indexOf('.ausgangszustand') > 0) {
                    this.getObject(id, (err, obj) => {
                        if (err) {
                            this.log.debug(err.toString());
                        } else {
                            if (obj && Object.prototype.hasOwnProperty.call(obj.native, 'ein') && state.val) {
                                //this.log.debug(obj.native.ein);
                                this.sendCommand(channelid, obj.native.ein);
                            } else if (obj && Object.prototype.hasOwnProperty.call(obj.native, 'aus') && !state.val) {
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

    /**
     * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
     * Using this method requires "common.messagebox" property to be set to true in io-package.json
     *
     * @param {ioBroker.Message} obj Message
     */
    onMessage(obj) {
        //this.log.debug(JSON.stringify(obj));
        if (typeof obj === 'object') {
            if (obj.command === 'newKey') {
                if (obj.callback) {
                    const key = vds.getRandomKey();
                    this.sendTo(obj.from, obj.command, [{ label: key, value: key }], obj.callback);
                }
            }
        }
    }

    /**
     * start socket server for listining
     */
    serverStart() {
        servertcp = net.createServer(this.onClientConnected.bind(this));
        servertcp.listen(this.config.bindPort, this.config.bindIP, () => {
            const text = `Server listening on IP-Adress (TCP): ${servertcp.address().address}:${servertcp.address().port}`;
            this.log.info(text);
            this.setState('info.connection', true, true);
        });
        servertcp.on('error', e => {
            this.log.error(e.message);
        });
    }

    /**
     * alarm system connected (TCP/IP)
     *
     * @param {net.Socket} sock - socket
     */
    onClientConnected(sock) {
        const remoteAddress = `${sock.remoteAddress}:${sock.remotePort}`;
        this.log.debug(`Verbindung von ${remoteAddress}`);
        const AE = new vds();

        AE.on('log', (msg, level) => {
            switch (level) {
                case 'debug':
                    this.log.debug(`AE: ${msg}`);
                    break;
                case 'warn':
                    this.log.warn(`AE: ${msg}`);
                    break;
                case 'error':
                    this.log.error(`AE: ${msg}`);
                    break;
                default:
                    this.log.info(`AE: ${msg}`);
            }
        });

        AE.on('connect', obj => {
            this.log.debug(`connect ID: ${obj.id}`);
            this.setConnectState(obj, true, AE);
        });

        AE.on('disconnect', obj => {
            this.log.debug(`disconnect ID: ${obj.id}`);
            this.setConnectState(obj, false, AE);
        });

        AE.on('data', obj => {
            if (obj && typeof obj === 'object') {
                this.log.debug(`Daten von: ${AE.Identnummer}`);
                this.zerlegeDaten(AE.Identnummer === '' ? 'unbekannt' : AE.Identnummer, obj);
            }
        });

        AE.setLogLevel(this.log.level);
        AE.Polling = this.config.pollIntervall;
        if (this.config.devices.length > 0) {
            this.config.devices.forEach(obj => {
                try {
                    // @ts-expect-error obj_parameter
                    AE.addDevice(obj.identnr, obj.stehend, obj.keynr, obj.key);
                } catch (e) {
                    this.log.error(`Setzen Geraetedaten nicht moeglich ${e}`);
                }
            });
        }

        AE.connect(sock);

        sock.on('data', data => {
            //this.log.info('received from ' + remoteAddress + ' following data: ' + JSON.stringify(data));
            AE.received(data);
        });
        sock.on('close', () => {
            this.log.debug(`connection from ${remoteAddress} closed`);
            AE.disconnect();
        });
        sock.on('error', err => {
            this.log.error(`Connection ${remoteAddress} error: ${err.message}`);
        });
    }

    /**
     * Setzt den Verbindungszustand und speichert die Verweise
     *
     * @param {object} id_obj {'id':Identnummer, 'address': IP:Port}
     * @param {boolean} state Zustand
     * @param {vds | null} AE Verwalter
     */
    async setConnectState(id_obj, state, AE) {
        try {
            queueConnect.push({ id: id_obj.id, state: state, ae: AE, command: [], address: id_obj.address });
            if (isChangeConnect) {
                return;
            }
            isChangeConnect = true;
            let obj;
            let i;
            let isVerbunden;
            while (queueConnect.length > 0) {
                isVerbunden = false;
                obj = queueConnect.shift();
                if (obj.state) {
                    //Aufbau
                    for (i = 0; i < devicesConnected.length; i++) {
                        if (devicesConnected[i].id === obj.id) {
                            isVerbunden = true;
                        }
                    }
                    devicesConnected.push(obj);
                    if (isVerbunden) {
                        this.log.warn(`Identnummer ${obj.id} schon verbunden!`);
                    } else {
                        await this.grundstrukturAnlegen(obj.id);
                    }
                    await this.setStateAsync(`${obj.id}.Info.zustand`, obj.state, true);
                } else {
                    //Abbau
                    if (devicesConnected.length === 0) {
                        this.log.debug('Abbau ohne Aufbau??? Warten!');
                        await this.Sleep(500);
                        if (devicesConnected.length === 0) {
                            await this.Sleep(500);
                        }
                        this.log.debug(`Jetzt nach Warten: ${devicesConnected.length.toString()}`);
                    }
                    for (i = 0; i < devicesConnected.length; i++) {
                        if (devicesConnected[i].id === obj.id) {
                            if (devicesConnected[i].address === obj.address) {
                                //selbe ID und Verbindung
                                devicesConnected.splice(i, 1);
                                i--;
                            } else {
                                isVerbunden = true; //selbe ID, aber andere Verbindung
                            }
                        }
                    }
                    if (!isVerbunden) {
                        await this.setStateAsync(`${obj.id}.Info.zustand`, obj.state, true);
                    }
                }
            }
        } catch (e) {
            this.log.error(`setConnectState: ${e}`);
        } finally {
            isChangeConnect = false;
        }
    }

    /**
     * Setzt die States f�r Abfrage und Fehler nach einem Befehl
     *
     * @param {string} channel ChannelID oder Identnummer
     * @param {string} meldung Fehlermeldung
     * @param {number} satz Datensatz (0x03, 0x11 oder 0x20)
     */
    async checkCommand(channel, meldung, satz) {
        let identnr;
        //let isChannelIdentnr = false;
        if (channel.indexOf('.') >= 0) {
            identnr = channel.split('.')[2];
        } else {
            identnr = channel;
            //isChannelIdentnr = true;
        }
        for (let i = 0; i < devicesConnected.length; i++) {
            if (devicesConnected[i].id === identnr) {
                for (let x = 0; x < devicesConnected[i].command.length; x++) {
                    if (satz === 0x11) {
                        await this.setStateAsync(`${devicesConnected[i].command[x].channelid}.abfrage`, false, true);
                        await this.setStateAsync(`${devicesConnected[i].command[x].channelid}.fehler`, meldung, true);
                        await this.setStateAsync(`${devicesConnected[i].command[x].channelid}.zeit_empfang`, '', true);
                    }
                    devicesConnected[i].command.splice(x, 1);
                    return;
                }
            }
        }
    }

    /**
     * Sendet den Befehl
     *
     * @param {string} channelid Channel-Id
     * @param {string} command Vollstaendiger Satz (0x02 oder 0x10)
     */
    async sendCommand(channelid, command) {
        const identnr = channelid.split('.')[2];
        this.log.debug(`Befehl: ${command} fuer id: ${identnr}`);
        for (let i = 0; i < devicesConnected.length; i++) {
            if (devicesConnected[i].id === identnr) {
                devicesConnected[i].command.push({ channelid: channelid, satz: command });
                devicesConnected[i].ae.sendCommand(command);
                return;
            }
        }
        await this.setStateAsync(`${channelid}.abfrage`, false, true);
        await this.setStateAsync(`${channelid}.fehler`, 'keine Verbindung', true);
        await this.setStateAsync(`${channelid}.zeit_empfang`, '', true);
    }

    /**
     * Legt die Grundstruktur an, wenn nicht vorhanden (Device)
     *
     * @param {string} id Identnummer
     */
    async grundstrukturAnlegen(id) {
        try {
            const objectCheck = await this.getStateAsync(`${id}.Info.merkmale`);
            if (objectCheck) {
                return;
            }
            await this.createDeviceAsync(id, { name: id });
            await this.createChannelAsync(id, 'Info', { name: 'Information' });
            await this.createStateAsync(id, 'Info', 'zustand', {
                role: 'indicator.connected',
                name: 'Verbindung steht',
                type: 'boolean',
                read: true,
                write: false,
                def: false,
            });
            await this.createStateAsync(id, 'Info', 'letzteTestmeldung', {
                role: 'info',
                name: 'Letzte Testmeldung',
                type: 'string',
                read: true,
                write: false,
                def: '',
            });
            await this.createStateAsync(id, 'Info', 'hersteller', {
                role: 'info',
                name: 'Herstellerinfo',
                type: 'string',
                read: true,
                write: false,
                def: '',
            });
            await this.createStateAsync(id, 'Info', 'merkmale', {
                role: 'info',
                name: 'Geraetemerkmale',
                type: 'string',
                read: true,
                write: false,
                def: '',
            });
        } catch (e) {
            this.log.error(`grundstrukturAnlegen: ${e}`);
        }
    }

    /**
     * Legt die Linien an, wenn nicht vorhanden (Channel und State)
     *
     * @param {string} id Identnummer
     * @param {number} li Adresse
     * @param {number} ge Geraet
     * @param {number} be Bereich
     * @param {number} az Adresszusatz
     * @param {string} art Adresserweiterung
     * @returns {Promise<string>} ID vom State
     */
    async linieAnlegen(id, li, ge, be, az, art) {
        const channel_id = `${id}.${art}_${li}-${ge}-${be}-${az}`;
        try {
            const obj = await this.getObjectAsync(channel_id);
            if (!obj) {
                const channel = `${art}_${li}-${ge}-${be}-${az}`;
                const name = `Li:${li} Ge:${ge} Be:${be} AdrZus:${az}`;
                const gebe = ((ge << 4) & 0xf0) | (be & 0x0f);
                let Adresserweiterung;
                if (art === 'Stoerung') {
                    switch (li) {
                        case 1:
                            await this.createChannelAsync(id, channel, { name: 'Unterspannung' });
                            break;
                        case 2:
                            await this.createChannelAsync(id, channel, { name: 'Akkufehler' });
                            break;
                        case 3:
                            await this.createChannelAsync(id, channel, { name: 'Netzfehler' });
                            break;
                        case 17:
                            await this.createChannelAsync(id, channel, { name: 'Fehler Uebertragungs-Primaerweg' });
                            break;
                        case 18:
                            await this.createChannelAsync(id, channel, { name: 'Fehler Uebertragungs-Ersatzweg' });
                            break;
                        default:
                            await this.createChannelAsync(id, channel);
                            break;
                    }
                } else {
                    await this.createChannelAsync(id, channel, { name: name });
                }
                switch (art) {
                    case 'Eingang':
                        Adresserweiterung = 1;
                        await this.createStateAsync(id, channel, 'meldungszustand', {
                            role: 'indicator.state',
                            name: 'Meldungszustand',
                            type: 'boolean',
                            read: true,
                            write: false,
                            def: false,
                            states: {
                                true: 'Ein',
                                false: 'Aus',
                            },
                        });
                        await this.createStateAsync(id, channel, 'meldungsart', {
                            role: 'value',
                            name: 'Meldungsart',
                            type: 'number',
                            read: true,
                            write: false,
                            def: 128,
                        });
                        await this.createStateAsync(id, channel, 'meldungVds', {
                            role: 'value',
                            name: 'Text',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        });
                        await this.createStateAsync(id, channel, 'text', {
                            role: 'value',
                            name: 'Text zur Meldung',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        });
                        await this.createStateAsync(id, channel, 'zeit_meldung', {
                            role: 'datetime',
                            name: 'Zeitpunkt der Ausloesung',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        });
                        await this.createStateAsync(id, channel, 'zeit_empfang', {
                            role: 'datetime',
                            name: 'Zeitpunkt des Empfangs',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        });
                        await this.createStateAsync(id, channel, 'weg', {
                            role: 'value',
                            name: 'Uebertragungsweg',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        });
                        await this.createStateAsync(id, channel, 'fehler', {
                            role: 'info',
                            name: 'Fehlermeldung',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        });
                        await this.createStateAsync(
                            id,
                            channel,
                            'abfrage',
                            {
                                role: 'button',
                                name: 'Abfrage des Zustands',
                                type: 'boolean',
                                read: true,
                                write: true,
                                def: false,
                            },
                            {
                                status: Buffer.from([5, 0x10, gebe, li, az, Adresserweiterung, 0x20]).toString('hex'),
                            },
                        );
                        break;
                    case 'Ausgang':
                        Adresserweiterung = 2;
                        await this.createStateAsync(
                            id,
                            channel,
                            'ausgangszustand',
                            {
                                role: 'indicator.state',
                                name: 'Ausgangszustand',
                                type: 'boolean',
                                read: true,
                                write: true,
                                def: false,
                                states: {
                                    true: 'Ein',
                                    false: 'Aus',
                                },
                            },
                            {
                                ein: Buffer.from([5, 2, gebe, li, az, Adresserweiterung, 0]).toString('hex'),
                                aus: Buffer.from([5, 2, gebe, li, az, Adresserweiterung, 128]).toString('hex'),
                            },
                        );
                        await this.createStateAsync(id, channel, 'zeit_empfang', {
                            role: 'datetime',
                            name: 'Zeitpunkt des Empfangs',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        });
                        await this.createStateAsync(id, channel, 'fehler', {
                            role: 'info',
                            name: 'Fehlermeldung',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        });
                        await this.createStateAsync(
                            id,
                            channel,
                            'abfrage',
                            {
                                role: 'button',
                                name: 'Abfrage des Zustands',
                                type: 'boolean',
                                read: true,
                                write: true,
                                def: false,
                            },
                            {
                                status: Buffer.from([5, 0x10, gebe, li, az, Adresserweiterung, 0x20]).toString('hex'),
                            },
                        );
                        break;
                    case 'Stoerung':
                        Adresserweiterung = 0x10;
                        await this.createStateAsync(id, channel, 'meldungszustand', {
                            role: 'indicator.state',
                            name: 'Meldungszustand',
                            type: 'boolean',
                            read: true,
                            write: false,
                            def: false,
                            states: {
                                true: 'Ein',
                                false: 'Aus',
                            },
                        });
                        await this.createStateAsync(id, channel, 'meldungsart', {
                            role: 'value',
                            name: 'Meldungsart',
                            type: 'number',
                            read: true,
                            write: false,
                            def: 128,
                        });
                        await this.createStateAsync(id, channel, 'meldungVds', {
                            role: 'value',
                            name: 'Text',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        });
                        await this.createStateAsync(id, channel, 'text', {
                            role: 'value',
                            name: 'Text',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        });
                        await this.createStateAsync(id, channel, 'zeit_meldung', {
                            role: 'datetime',
                            name: 'Zeitpunkt der Ausloesung',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        });
                        await this.createStateAsync(id, channel, 'zeit_empfang', {
                            role: 'datetime',
                            name: 'Zeitpunkt des Empfangs',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        });
                        await this.createStateAsync(id, channel, 'fehler', {
                            role: 'info',
                            name: 'Fehlermeldung',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        });
                        await this.createStateAsync(
                            id,
                            channel,
                            'abfrage',
                            {
                                role: 'button',
                                name: 'Abfrage des Zustands',
                                type: 'boolean',
                                read: true,
                                write: true,
                                def: false,
                            },
                            {
                                status: Buffer.from([5, 0x10, gebe, li, az, Adresserweiterung, 0x20]).toString('hex'),
                            },
                        );
                        break;
                }
            }
            return channel_id;
        } catch (e) {
            this.log.error(`linieAnlegen: ${e}`);
            return channel_id;
        }
    }

    Sleep(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    /**
     * Empfangene Daten
     *
     * @param {string} id Identnummer
     * @param {object} obj Daten als JSON
     */
    async zerlegeDaten(id, obj) {
        let channel = '';
        try {
            const date = new Date();
            const zeit = date.toLocaleString('de-DE');

            await this.grundstrukturAnlegen(id);

            let Meldungszeit = '';
            if (Object.prototype.hasOwnProperty.call(obj, 'Satz_50')) {
                const zeit = new Date(obj['Satz_50'].Value);
                Meldungszeit = zeit.toLocaleString('de-DE');
            }
            if (
                Object.prototype.hasOwnProperty.call(obj, 'Satz_2') ||
                Object.prototype.hasOwnProperty.call(obj, 'Satz_3') ||
                Object.prototype.hasOwnProperty.call(obj, 'Satz_4') ||
                Object.prototype.hasOwnProperty.call(obj, 'Satz_20')
            ) {
                let satz = 'Satz_2';
                if (Object.prototype.hasOwnProperty.call(obj, 'Satz_3')) {
                    satz = 'Satz_3';
                } else if (Object.prototype.hasOwnProperty.call(obj, 'Satz_4')) {
                    satz = 'Satz_4';
                } else if (Object.prototype.hasOwnProperty.call(obj, 'Satz_20')) {
                    satz = 'Satz_20';
                }
                channel = await this.linieAnlegen(
                    id,
                    obj[satz].Adresse,
                    obj[satz].Geraet,
                    obj[satz].Bereich,
                    obj[satz].Adresszusatz,
                    obj[satz].Adresserweiterung,
                );
                let name = vdsmeldungen[obj[satz].Meldungsart];
                if (typeof name === 'undefined') {
                    name = '';
                }
                if (obj[satz].Adresserweiterung === 'Eingang') {
                    await this.setStateAsync(`${channel}.abfrage`, false, true);
                    await this.setStateAsync(`${channel}.fehler`, '', true);
                    await this.setStateAsync(
                        `${channel}.meldungszustand`,
                        obj[satz].Meldungsart < 128 ? true : false,
                        true,
                    );
                    await this.setStateAsync(`${channel}.meldungsart`, obj[satz].Meldungsart, true);
                    await this.setStateAsync(`${channel}.meldungVds`, name, true);
                    await this.setStateAsync(
                        `${channel}.text`,
                        Object.prototype.hasOwnProperty.call(obj, 'Satz_54') ? obj['Satz_54'].Value : '',
                        true,
                    );
                    await this.setStateAsync(`${channel}.zeit_meldung`, Meldungszeit, true);
                    await this.setStateAsync(`${channel}.zeit_empfang`, zeit, true);
                    await this.setStateAsync(
                        `${channel}.weg`,
                        Object.prototype.hasOwnProperty.call(obj, 'Satz_61') ? obj['Satz_61'].Value : '',
                        true,
                    );
                } else if (obj[satz].Adresserweiterung === 'Ausgang') {
                    await this.setStateAsync(
                        `${channel}.ausgangszustand`,
                        obj[satz].Meldungsart < 128 ? true : false,
                        true,
                    );
                    await this.setStateAsync(`${channel}.zeit_empfang`, zeit, true);
                    await this.setStateAsync(`${channel}.abfrage`, false, true);
                    await this.setStateAsync(`${channel}.fehler`, '', true);
                } else {
                    await this.setStateAsync(
                        `${channel}.meldungszustand`,
                        obj[satz].Meldungsart < 128 ? true : false,
                        true,
                    );
                    await this.setStateAsync(`${channel}.meldungsart`, obj[satz].Meldungsart, true);
                    await this.setStateAsync(
                        `${channel}.text`,
                        Object.prototype.hasOwnProperty.call(obj, 'Satz_54') ? obj['Satz_54'].Value : '',
                        true,
                    );
                    await this.setStateAsync(`${channel}.zeit_meldung`, Meldungszeit, true);
                    await this.setStateAsync(`${channel}.zeit_empfang`, zeit, true);
                    await this.setStateAsync(`${channel}.abfrage`, false, true);
                    await this.setStateAsync(`${channel}.fehler`, '', true);
                }
            }
            if (Object.prototype.hasOwnProperty.call(obj, 'Satz_3')) {
                await this.checkCommand(channel, '', 0x03);
            }
            if (Object.prototype.hasOwnProperty.call(obj, 'Satz_11')) {
                await this.checkCommand(id, obj['Satz_11'].Value, 0x11);
            }
            if (Object.prototype.hasOwnProperty.call(obj, 'Satz_20')) {
                await this.checkCommand(channel, '', 0x20);
            }
            if (Object.prototype.hasOwnProperty.call(obj, 'Satz_40')) {
                await this.setStateAsync(`${id}.Info.letzteTestmeldung`, zeit, true);
            }
            if (Object.prototype.hasOwnProperty.call(obj, 'Satz_51')) {
                await this.setStateAsync(`${id}.Info.hersteller`, obj['Satz_51'].Value, true);
            }
            if (Object.prototype.hasOwnProperty.call(obj, 'Satz_59')) {
                await this.setStateAsync(`${id}.Info.merkmale`, obj['Satz_59'].Value, true);
            }
        } catch (e) {
            this.log.error(`zerlegeDaten: ${e}`);
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options] Adapteroptionen
     */
    module.exports = options => new Vds2465Server(options);
} else {
    // otherwise start the instance directly
    new Vds2465Server();
}
