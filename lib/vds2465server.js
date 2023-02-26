'use strict'
const eventhandler = require('events');
const crypto = require('crypto');

const _level = ['silly', 'debug', 'info', 'warn', 'error'];
const _action = {
	'Connect': 1,
	'Daten': 2,
	'Disconnect': 3,
	'IK3': 4,
	'IK4': 5,
	'IK5': 6,
	'IK6': 7,
	'Checksummenfehler': 8,
	'IK3_nach_Pollzeit': 9,
	'Timer_abgelaufen': 10,
	'Wiederholung': 11,
	'VdSServiceRequest': 12
}

class vds2465server extends eventhandler{
	#TC;
	#RC_rec;
	#RC;
	#TC_rec;
	#IK;
	#PK;
	#SL;
	#L;
	#VdSRequestCounter;
	#LastSend;
	#SendeZaehler;
	#Socket;
	#AddressPort;
	#Algorithm;
	#MinLaenge;
	#Loglevel;
	#SendeSpeicher;
	#EmpfangsSpeicher;
	#Inhalt;
	#KeyNr_rec;
	#TimerAnswer;
	#TimerPoll
	#Polling;
	#UnbekannterKey;

	#Stehend;
	#KeyNr;
	#Key;
	#Id;
	#KeyList;

	constructor() {
		super();

		this.#TC = Math.floor(Math.random() * 0xffffffff);
		this.#SendeZaehler = 0;
		this.#Socket = null;
		this.#AddressPort = '';
		this.#Algorithm = 'aes-128-cbc';
		this.#MinLaenge = 48;
		this.#Loglevel = 'info';
		this.#TimerAnswer = null;
		this.#TimerPoll = null;
		this.#Polling = 8000;
		this.#UnbekannterKey = false;
		this.#SendeSpeicher = [];
		this.#EmpfangsSpeicher = Buffer.alloc(0);
		this.#Inhalt = {};
		this.#KeyNr_rec = 0;
		this.#VdSRequestCounter = 0;

		this.#Stehend = false;
		this.#KeyNr = 0;
		this.#Key = '';
		this.#Id = 0;
		this.#KeyList = [];
		this.connect = this.connect.bind(this);
		this.disconnect = this.disconnect.bind(this);
		this.received = this.received.bind(this);
	};

	/**
	* Setzt den Pollintervall
	* @param {number} value Der Pollintervall zwischen 3 und 8 Sekunden
	*/
	set Polling(value){
		if (value >= 3 && value <= 8) {
			this.#Polling = value * 1000;
		}
	}

	/**
	* Gibt die Identnummer der Verbindung zurueck
	* @returns {String} die Identnummer
	*/
	get Identnummer() {
		if (this.#Id === 0) {
			return '';
		} else {
			return this.#Id.toString();
		}
	}

	/**
	* Gibt ein Zufalls-Schluessel AES128 zurueck
	* @returns {String} der Schluessel
	*/
	static getRandomKey() {
		return crypto.randomBytes(16).toString('hex');
	}

	/**
	* Loescht alle Geraete
	*/
	delAllDevices() {
		this.#KeyList = [];
	}

	/**
	* Setzt die Geraetedaten fuer den Empfang
	* @param {String | Number} identnr die Identnummer
	* @param {Boolean} stehend true bei stehender Verbindung
	* @param {number} keynr Die Schluesselnummer von 0 bis 65534
	* @param {String} key Der Schluessel in hexadezimal mit einer Laenge von 16 Byte
	*/
	addDevice(identnr, stehend, keynr, key = '') {
		try {
			let obj = {};
			obj.identnr = '999999999999';
			if (typeof identnr === 'string' && identnr.length <= 12) {
				obj.identnr = identnr;
			} else if (typeof identnr === 'number') {
				obj.identnr = identnr.toString();
			}
			obj.stehend = false;
			if (typeof stehend === 'boolean' && stehend) {
				obj.stehend = true;
			}
			obj.keynr = 0;
			if (typeof keynr === 'number' && keynr >= 0 && keynr < 65535) {
				obj.keynr = keynr;
			}
			obj.key = '';
			if (key.length === 32) {
				let tmp = key.toLowerCase();
				let reg = new RegExp('[0-9a-f]{32}');
				if (reg.test(tmp)) {
					obj.key = tmp;
				}
			}
			if (this.#KeyList.length > 0) {
				let findindex = -1;
				for (let i = 0; i < this.#KeyList.length; i++) {
					if (this.#KeyList[i].keynr === obj.keynr) {
						findindex = i;
						break;
					}
				}
				if (findindex === -1) {
					this.#KeyList.push(obj);
				} else {
					this.#KeyList[findindex] = obj;
				}
			} else {
				this.#KeyList.push(obj);
			}
			this.#logging(`Geraet uebernommen: ${JSON.stringify(obj)}`, 'debug');
		}
		catch (e) {
			this.#logging('addDevice: ' + e,'error');
		}
	}

	/**
	* Startet Kommunikation
	* @param {net.Socket} sock Der Socket zum Geraet
	*/
	connect(sock) {
		this.#Socket = sock;
		this.#AddressPort = `${sock.remoteAddress}:${sock.remotePort}`;
		this.#controller(_action.Connect);
	}

	/**
	* Sendet den Datensatz ans Geraet
	* @param {Buffer | String} data Der vollstaendige Datensatz zum Senden
	*/
	sendCommand(data) {
		if (typeof data === 'string') {
			let buf = Buffer.from(data, 'hex');
			this.#SendeSpeicher.push(buf);
		} else {
			this.#SendeSpeicher.push(data);
		}
	}

	/**
	* Beendet die Kommunikation
	*/
	disconnect() {
		this.#controller(_action.Disconnect);
	}

	/**
	* Uebernimmt Daten vom Geraet
	* @param {Buffer} data Die empfangenden Daten
	*/
	received(data) {
		this.#EmpfangsSpeicher = Buffer.concat([this.#EmpfangsSpeicher, Buffer.from(data)]);
		this.#controller(_action.Daten);
	}

	/**
	* Setzt den LogLevel
	* @param {string} target log.level
	*/
	setLogLevel(target) {
		if (typeof target === 'string' && _level.indexOf(target) >= 0) {
			this.#Loglevel = target;
		}
	}

	/**
	* Trennt die Verbindung und setzt alles zurueck
	*/
	#disconnect() {
		if (this.#Socket) {
			this.#Socket.end();
			this.#Socket = null;
		}
		if (this.#TimerAnswer) {
			clearTimeout(this.#TimerAnswer);
			this.#TimerAnswer = null;
		}
		if (this.#TimerPoll) {
			clearTimeout(this.#TimerPoll);
			this.#TimerPoll = null;
		}
		if (this.#Id) {
			this.emit('disconnect', { 'id': this.#Id.toString(), 'address': this.#AddressPort });
		}
		this.#TC = Math.floor(Math.random() * 0xffffffff);
		this.#SendeSpeicher = [];
		this.#EmpfangsSpeicher = Buffer.alloc(0);
		this.#LastSend = null;
		this.#SendeZaehler = 0;
		this.#UnbekannterKey = false;
		this.#Id = 0;
		this.#Inhalt = {};
		this.#KeyNr_rec = 0;
		this.#KeyList = [];
		this.#AddressPort = '';
	}

	/**
	* Steuert die Ablaeufe
	* @param {number} func
	*/
	#controller(func) {
		if (!func) {
			return;
		}
		let data;
		switch (func) {
			case _action.Connect:
				this.#sendIK1();
				this.#timer();
				break;
			case _action.Daten:
				if (this.#LaengePruefen(this.#EmpfangsSpeicher)) {
					if (this.#SchluesselPruefen(this.#EmpfangsSpeicher)) {
						data = this.#cutDatensatz();
						this.#logging('in: ' + data.toString('hex'), 'silly');
						if (this.#EmpfangsSpeicher.length > 0) {
							this.#logging('Rest Speicher: ' + this.#EmpfangsSpeicher.toString('hex'), 'silly');
						}
						if (this.#Auswertung(data)) {
							//clearTimeout(this._Timer);
						}
					} else {
						this.#logging('Schluesselnr '+ this.#KeyNr_rec +' ist unbekannt', 'error');
						this.#disconnect();
					}
				}
				break;
			case _action.Disconnect:
				this.#disconnect();
				break;
			case _action.IK3:
				this.#sendIK3();
				this.#timer();
				break;
			case _action.IK4:
				if (this.#TimerPoll) {
					clearTimeout(this.#TimerPoll);
				}
				this.#sendeMeldung();
				this.#timer();
				break;
			case _action.IK5:
				this.#sendIK5();
				this.#sendIK3();
				this.#timer();
				break;
			case _action.IK6:
				this.#sendIK6();
				this.#sendIK3();
				this.#timer();
				break;
			case _action.Disconnect:
				this.#disconnect();
				break;
			case _action.VdSServiceRequest:
				this.#VdSRequestCounter = 5;
				if (this.#TimerPoll) {
					clearTimeout(this.#TimerPoll);
				}
				this.#sendIK3();
				break;
			case _action.IK3_nach_Pollzeit:
				if (this.#TimerPoll) {
					clearTimeout(this.#TimerPoll);
				}
				if (this.#VdSRequestCounter > 0) {
					this.#sendIK3();
					this.#VdSRequestCounter--;
				} else {
					this.#TimerPoll = setTimeout(this.#controller.bind(this), this.#Polling, _action.IK3);
				}
				break;
			case _action.Timer_abgelaufen:
			case _action.Wiederholung:
				if (this.#TimerPoll) {
					clearTimeout(this.#TimerPoll);
				}
				this.#SendeZaehler++;
				if (this.#SendeZaehler > 3) {
					this.#disconnect();
					return;
				}
				this.#logging('Wiederhole letztes Telegramm', 'debug');
				this.#sendLastMessage();
				this.#timer();
				break;
			default:
				break;
		}
	}

	//Schneidet den Datensatz aus dem Speicher und gibt ihn zurueck
	#cutDatensatz() {
		let sl = this.#EmpfangsSpeicher.readUInt16BE(2);
		let data = this.#EmpfangsSpeicher.slice(0, sl + 4);
		if ((sl + 4) < this.#EmpfangsSpeicher.length) {
			this.#EmpfangsSpeicher = this.#EmpfangsSpeicher.slice(sl + 4);
		} else {
			this.#EmpfangsSpeicher = Buffer.alloc(0);
		}
		return data;
	}

	#logging(msg,level = 'info') {
		if (_level.indexOf(level) >= _level.indexOf(this.#Loglevel)) {
			this.emit('log', msg, level);
		}
	}

	//Timer fuer das ausbleiben einer Antwort
	#timer() {
		if (this.#TimerAnswer) {
			clearTimeout(this.#TimerAnswer);
		}
		this.#TimerAnswer = setTimeout(this.#controller.bind(this), this.#Polling + 1000, _action.Timer_abgelaufen);
	}

	#send(buf) {
		if (this.#Socket) {
			this.#LastSend = Buffer.from(buf);
			this.#Socket.write(this.#LastSend, 'hex');
		}
	}

	//Sendet letzte Meldung
	#sendLastMessage() {
		if (this.#Socket) {
			this.#Socket.write(this.#LastSend, 'hex');
		}
	}

	#sendIK1() {
		let offset = 0;
		let buf = Buffer.alloc(14);
		//TC
		offset = buf.writeUInt32BE(this.#TC++, offset);
		if (this.#TC > 0xFFFFFFFF)
			this.#TC = 0;
		//CRC16
		offset = buf.writeUInt16BE(0, offset);
		//RC
		offset = buf.writeUInt32BE(0, offset);
		//IK
		offset = buf.writeUInt8(1, offset);
		//PK
		offset = buf.writeUInt8(1, offset);
		//L
		offset = buf.writeUInt8(1, offset);
		//Fenstergroesse
		offset = buf.writeUInt8(1, offset);

		buf = this.#Telegramm_Zusatz(buf);
		this.#logging('out IK1: ' + buf.toString('hex'), 'silly');
		this.#send(buf);
	}

	#sendIK3() {
		let offset = 0;
		let buf = Buffer.alloc(13);
		//TC
		offset = buf.writeUInt32BE(this.#TC++, offset);
		if (this.#TC > 0xFFFFFFFF)
			this.#TC = 0;
		//CRC16
		offset = buf.writeUInt16BE(0, offset); //später
		//RC
		this.#RC = this.#TC_rec + 1;
		if (this.#RC > 0xFFFFFFFF)
			this.#RC = 0;
		offset = buf.writeUInt32BE(this.#RC, offset);
		//IK
		offset = buf.writeUInt8(3, offset);
		//PK
		offset = buf.writeUInt8(1, offset);
		//L
		offset = buf.writeUInt8(0, offset);

		buf = this.#Telegramm_Zusatz(buf);
		this.#logging('out IK3: ' + buf.toString('hex'), 'silly');
		this.#send(buf);
	}

	#sendIK5() {
		let offset = 0;
		let buf = Buffer.alloc(13);
		//TC
		offset = buf.writeUInt32BE(this.#TC++, offset);
		if (this.#TC > 0xFFFFFFFF)
			this.#TC = 0;
		//CRC16
		offset = buf.writeUInt16BE(0, offset); //später
		//RC
		this.#RC = this.#TC_rec + 1;
		if (this.#RC > 0xFFFFFFFF)
			this.#RC = 0;
		offset = buf.writeUInt32BE(this.#RC, offset);
		//IK
		offset = buf.writeUInt8(5, offset);
		//PK
		offset = buf.writeUInt8(1, offset);
		//L
		offset = buf.writeUInt8(0, offset);

		buf = this.#Telegramm_Zusatz(buf);
		this.#logging('out IK5: ' + buf.toString('hex'), 'silly');
		this.#send(buf);
	}

	#sendIK6() {
		let offset = 0;
		let buf = Buffer.alloc(13);
		//TC
		offset = buf.writeUInt32BE(this.#TC++, offset);
		if (this.#TC > 0xFFFFFFFF)
			this.#TC = 0;
		//CRC16
		offset = buf.writeUInt16BE(0, offset); //später
		//RC
		this.#RC = this.#TC_rec + 1;
		if (this.#RC > 0xFFFFFFFF)
			this.#RC = 0;
		offset = buf.writeUInt32BE(this.#RC, offset);
		//IK
		offset = buf.writeUInt8(6, offset);
		//PK
		offset = buf.writeUInt8(1, offset);
		//L
		offset = buf.writeUInt8(0, offset);

		buf = this.#Telegramm_Zusatz(buf);
		this.#logging('out IK6: ' + buf.toString('hex'), 'silly');
		this.#send(buf);
	}

	#sendeMeldung() {
		let offset = 0;
		let buf = Buffer.alloc(12);
		//TC
		offset = buf.writeUInt32BE(this.#TC++, offset);
		if (this.#TC > 0xFFFFFFFF)
			this.#TC = 0;
		//CRC16
		offset = buf.writeUInt16BE(0, offset); //später
		//RC
		this.#RC = this.#TC_rec + 1;
		if (this.#RC > 0xFFFFFFFF)
			this.#RC = 0;
		offset = buf.writeUInt32BE(this.#RC, offset);
		//IK
		offset = buf.writeUInt8(4, offset);
		//PK
		offset = buf.writeUInt8(1, offset);

		buf = Buffer.concat([buf,this.#VdS2465_Zusammenstellen()]);
		buf = this.#Telegramm_Zusatz(buf);
		this.#logging('out IK4: ' + buf.toString('hex'), 'silly');
		this.#send(buf);
	}

	/**
	* Gibt den Satz41 (TestmeldungQuittung) zurueck
	* @returns {Buffer}
	*/
	#getTestmeldungQuittungBuffer() {
		let buf = Buffer.alloc(2);
		buf.writeUInt8(0, 0);
		buf.writeUInt8(0x41, 1);
		return Buffer.concat([buf,this.#getDatumUhrzeitBuffer(null)]);
	}

	/**
	* Gibt den Satz50 (Datum und Uhrzeit) zurueck
	* @param {string | null} date Datum und Uhrzeit
	* @returns {Buffer}
	*/
	#getDatumUhrzeitBuffer(date) {
		let datum;
		if (typeof date === 'string') {
			datum = new Date(date);
		}
		else {
			datum = new Date();
		}
		//log('Datum: ' + datum.toUTCString());
		const Jahr = datum.getFullYear();
		const Monat = datum.getMonth() + 1;
		const Tag = datum.getDate();
		const Stunde = datum.getHours();
		const Minute = datum.getMinutes();
		const Sekunde = datum.getSeconds();
		let offset = 0;
		let buf = Buffer.alloc(9);
		buf.writeUInt8(7, offset++);
		buf.writeUInt8(0x50, offset++);
		buf.writeUInt8(Jahr % 100, offset++);
		buf.writeUInt8(Jahr / 100, offset++);
		buf.writeUInt8(Monat, offset++);
		buf.writeUInt8(Tag, offset++);
		buf.writeUInt8(Stunde, offset++);
		buf.writeUInt8(Minute, offset++);
		buf.writeUInt8(Sekunde, offset++);
		//log('Datum als buffer: ' + buf.toString('hex'), 'debug');
		return buf;
	}

	/**
	* Gibt Identnummer zurueck
	* @param {number} SL Satzlaenge
	* @param {Buffer} data Datensatz
	* @returns {String}
	*/
	#getIdentnummer(SL, data) {
		let Id = '', temp;
		if (SL === 0 || data.length !== SL) {
			return Id;
		}
		for (let pos = 0; pos < SL; pos++) {
			temp = data.readUInt8(pos);
			if ((temp & 0x0F) == 15) {  //Identnummer fehlerhaft mit 0xFF
				break;
			}
			temp = temp & 0x0F;
			if (temp != 15) {
				Id += temp.toString(10);
			}
			temp = data.readUInt8(pos);
			temp = (temp >> 4) & 0x0F;
			if (temp != 15) {
				Id += temp.toString(10);
			}
		}
		return Id;
	}

	//SatzFF keine stehende Verbindung
	#getTrennenBuffer() {
		if (!this.#Stehend) {
			let buf = Buffer.alloc(2);
			buf.writeUInt8(0xFF, 1);
			return buf;
		}
		else {
			let buf = Buffer.alloc(0);
			return buf;
		}
	}

	//Buffer ohne KeyNr und Laenge zum Checken übergeben
	#checkCRC16(data) {
		let crc = 0;
		let pos;
		let temp;
		let orginal = 0;
		let len = data.length;
		for (pos = 0; pos < len; pos += 2) {
			temp = data.readUInt8(pos);
			temp = temp << 8;
			if ((pos + 1) == len) {
				temp = temp | 0x00;
			} else {
				temp = temp | data.readUInt8(pos + 1);
			}
			if (pos == 4)	//Übermittelter CRC16 Wert
			{
				orginal = temp;
			} else {
				crc += temp;
			}
			if (crc > 65535) {
				crc &= 0xFFFF;
				crc++;
			}
		}
		crc = ~crc;
		crc = crc & 0xffff;
		if (crc == orginal)
			return true;
		else {
			this.#logging('CRC16 Fehler --> Orginal=' + orginal.toString(16) + ' Ausgerechnet=' + crc.toString(16),'error');
			return false;
		}
	}

	//Buffer komplett übergeben
	#setCRC16buffer(data) {
		let crc = 0;
		let pos;
		let temp;
		let len = data.length;
		for (pos = 0; pos < len; pos += 2) {
			temp = data.readUInt8(pos);
			temp = temp << 8;
			if ((pos + 1) == len) {
				temp = temp | 0x00;
			} else {
				temp = temp | data.readUInt8(pos + 1);
			}
			if (pos == 4) {
				continue;
			}
			crc += temp;
			if (crc > 65535) {
				crc &= 0xFFFF;
				crc++;
			}
		}
		crc = ~crc;
		crc = crc & 0xffff;
		data.writeUInt16BE(crc, 4);
		return data;
	}

	//Testet UInt32 auf gleiche Werte
	#isEqual(a, b) {
		if (!isNaN(a) && !isNaN(b)) {
			if ((a & 0xffffffff).toString(16) === (b & 0xffffffff).toString(16))
				return true;
		}
		return false;
	}

	#getKopf1Buffer(SL = 0) {
		let buf = Buffer.alloc(4);
		//KeyNr
		if (this.#UnbekannterKey) {
			buf.writeUInt16BE(this.#KeyNr, 0xFFFF);
		} else {
			buf.writeUInt16BE(this.#KeyNr_rec, 0);
		}
		//SL
		buf.writeUInt16BE(SL, 2);
		return buf;
	}

	//verschlüsseln
	#Verschluesseln(data) {
		if (data.length % 16) {
			data = this.#LaengeAnpassen(data);
		}
		this.#logging('out -> unverschluesselte Daten ohne Key und SL: ' + data.toString('hex'), 'silly');
		const iv = Buffer.alloc(16, 0); // Initialization vector.
		const cipher = crypto.createCipheriv(this.#Algorithm, Buffer.from(this.#Key, 'hex'), iv);
		let encrypted = cipher.update(data, 'hex');
		cipher.final();
		return encrypted;
	}

	//entschluesseln
	#Entschluesseln(data) {
		const iv = Buffer.alloc(16, 0); // Initialization vector.
		const decipher = crypto.createDecipheriv(this.#Algorithm, Buffer.from(this.#Key, 'hex'), iv);
		decipher.setAutoPadding(false);
		let decrypted = decipher.update(data, 'hex');
		decrypted = Buffer.concat([decrypted, decipher.final()]);
		return decrypted;
	}

	//Laenge anpassen auf 16 teilbar
	#LaengeAnpassen(daten) {
		if (Buffer.isBuffer(daten)) {
			let diff = 16 - (daten.length % 16);
			if ((daten.length + diff) < this.#MinLaenge) {
				diff = this.#MinLaenge - daten.length;
			}
			if (diff > 0) {
				let buf = Buffer.alloc(diff);
				return Buffer.concat([daten, buf]);
			}
		}
		return daten;
	}

	//Laenge , Pruefsumme und Verschluesselung
	#Telegramm_Zusatz(buf) {
		if (this.#KeyNr_rec > 0 && !this.#UnbekannterKey) //verschlüsseln
		{
			buf = this.#LaengeAnpassen(buf);
			buf = this.#setCRC16buffer(buf);
			buf = this.#Verschluesseln(buf);
		}
		else {
			buf = this.#setCRC16buffer(buf);
		}
		let SL = buf.length;
		buf = Buffer.concat([this.#getKopf1Buffer(SL), buf]);
		return buf;
	}

	//Telegrammzaehler ueberpruefen
	#pruefeTelegrammZaehler() {
		//this.#logging(`RC_rec=${this.#RC_rec} TC=${this.#TC}`, 'debug');
		if (this.#isEqual(this.#RC_rec, this.#TC)) {  //neue Meldung
			return true;
		}
		return false;
		/*
		if (this.#isEqual(this.#RC_rec, this.#TC)) {
			if (this.#SendeZaehler > 3) {
				this.#logging('3 Wiederholungen', 'warn');
				this.#controller(_action.Disconnect);
				return false;
			}
			this.#logging('Datensatz wiederholen (TelegrammZaehler)', 'warn');
			this.#controller(_action.Wiederholung);

			return false;
		}
		else if (this.#isEqual(this.#RC_rec, this.#TC + 1)) {  //neue Meldung
				return true;
		} else
			 {
				this.#logging('TelegrammZaehler falsch', 'warn');
				this.#controller(_action.Disconnect);
				return false;
		}
		*/
	}

	/**
	* Zerlegt die Daten in VdS2465-Satz-Typen
	* @param {Buffer} data Nutzdaten
	* @returns {Object}
	*/
	#VdS2465_Zerlegen(data){
		let offset = 0;
		let vds = {};
		let sl, typ = 0, Satz, Quitt = null;
		while (offset < data.length) {
			sl = data.readUInt8(offset++);
			typ = data.readUInt8(offset++);
			Satz = 'Satz_' + typ.toString(16);
			vds[Satz] = {};
			vds[Satz].RawData = data.toString('hex', offset - 2, offset + sl);
			switch (typ) {
				case 0x01:  //Priorität
					vds[Satz].Typ = "Prioritaet";
					if (sl === 1) {
						vds[Satz].Value = data.toString('hex', offset, offset + sl);
						offset += sl;
					}
					break;
				case 0x02:  //Meldung
					Quitt = Buffer.alloc(sl + 2);
					data.copy(Quitt, 0, offset - 2, offset + sl);
					Quitt.writeUInt8(0x03, 1);  //Satztyp von 2 auf 3
					this.#SendeSpeicher.unshift(Quitt);
				case 0x03:  //Quittung auf Meldung
				case 0x04:  //Meldung ohne Quittung
				case 0x20:  //Status
					switch (data.readUInt8(offset-1)) {
						case 0x02: vds[Satz].Typ = "Meldung Zustandsaenderung";
							break;
						case 0x03: vds[Satz].Typ = "Quittierungsruecksendung";
							break;
						case 0x04: vds[Satz].Typ = "Meldung Zustandsaenderung ohne Quittungsanforderung";
							break;
						case 0x20: vds[Satz].Typ = "Status";
							break;
					}
					vds[Satz].Geraet = data.readUInt8(offset) >> 4 & 0x0F;
					vds[Satz].Bereich = data.readUInt8(offset++) & 0x0F;
					vds[Satz].Adresse = data.readUInt8(offset++);
					vds[Satz].Adresszusatz = data.readUInt8(offset++);
					if (sl === 5) {
						switch (data.readUInt8(offset++)) {
							case 1: vds[Satz].Adresserweiterung = "Eingang";
								break;
							case 2: vds[Satz].Adresserweiterung = "Ausgang";
								break;
							case 0x10: vds[Satz].Adresserweiterung = "Stoerung";
								switch (vds[Satz].Adresse) {
									case 0x01: vds[Satz].Zusatz = 'Unterspannung';
										break;
									case 0x02: vds[Satz].Zusatz = 'Akkufehler';
										break;
									case 0x03: vds[Satz].Zusatz = 'Netzfehler';
										break;
									case 0x17: vds[Satz].Zusatz = 'Fehler Uebertragungs-Primaerweg';
										break;
									case 0x18: vds[Satz].Zusatz = 'Fehler Uebertragungs-Ersatzweg';
										break;
								}
								break;
						}
					} else {
						vds[Satz].Adresserweiterung = "Eingang";
					}
					vds[Satz].Meldungsart = data.readUInt8(offset++);
					break;
				case 0x10:  //Abfrage
					//this.#decodiereSatz10(sl, data.slice(offset, offset + sl));
					offset += sl;
					break;
				case 0x11:  //Fehler
					vds[Satz].Typ = "Fehler";
					vds[Satz].Geraet = data.readUInt8(offset++) >> 4 & 0x0F;
					switch (data.readUInt8(offset++)) {
						case 0:
							vds[Satz].Value = 'Allgemein: Fehler';
							break;
						case 1:
							vds[Satz].Value = 'Nicht bekannt';
							break;
						case 2:
							vds[Satz].Value = 'Nicht erfuellbar';
							break;
						case 3:
							vds[Satz].Value = 'Negativquittierung';
							break;
						case 4:
							vds[Satz].Value = 'Falscher Sicherheitscode';
							break;
						case 0x10:
							vds[Satz].Value = 'Adresse nicht vorhanden, ausserhalb des Bereichs';
							break;
						case 0x18:
							vds[Satz].Value = 'Funktion ist bei dieser Adresse nicht moeglich';
							break;
						case 0x20:
							vds[Satz].Value = 'Daten ausserhalb des Wertebereichs';
							break;
						case 0x80:
							vds[Satz].Value = 'Pruefsumme ist fehlerhaft';
							break;
						case 0xff:
							vds[Satz].Value = 'Satztyp unbekannt:';
							vds[Satz].Value += data.readUInt8(offset++).toString(16);
							break;
					}
					break;
				case 0x24:
					vds[Satz].Typ = "Blockstatus";
					offset += sl;
					break;
				case 0x26:  //Blockstatus Alles
					vds[Satz].Typ = "Blockstatus Alles";
					offset += sl;
					//let test = new Buffer([0x05,0x2,0,10,0,2,0x00]);
					//this.#SendeSpeicher.push(test);
					break;
				case 0x40:  //Testmeldung
					vds[Satz].Typ = "Testmeldung";
					offset += sl;
					this.#SendeSpeicher.unshift(this.#getTestmeldungQuittungBuffer());
					break;
				case 0x41:  //Quittung auf Testmeldung
					vds[Satz].Typ = "Quittung der Testmeldung";
					offset += sl;
					//log('Quittung Testmeldung');
					break;
				case 0x50:  //Datum und Uhrzeit
					vds[Satz].Typ = "Datum und Uhrzeit";
					vds[Satz].Value = new Date();
					vds[Satz].Value.setFullYear(data.readUInt8(offset) + (data.readUInt8(offset + 1) * 100));
					offset += 2;
					vds[Satz].Value.setMonth(data.readUInt8(offset++) - 1);
					vds[Satz].Value.setDate(data.readUInt8(offset++));
					if (sl === 6) {
						vds[Satz].Value.setHours(data.readUInt8(offset), data.readUInt8(offset + 1), 0, 0);
						offset += 2;
					} else {
						vds[Satz].Value.setHours(data.readUInt8(offset), data.readUInt8(offset + 1), data.readUInt8(offset + 2), 0);
						offset += 3;
					}
					break;
				case 0x51:  //Herstelleridentifikation
					vds[Satz].Typ = "Herstelleridentifikation";
					vds[Satz].Value = data.toString('latin1', offset, offset + sl);
					offset += sl;
					break;
				case 0x54:  //Zeichenfolge
					vds[Satz].Typ = "Zeichenfolge";
					vds[Satz].Value = data.toString('latin1', offset, offset + sl);
					offset += sl;
					break;
				case 0x55:  //aktuell unterstützte  Satztypen
					vds[Satz].Typ = "aktuell unterstuetzte Satztypen";
					offset += sl;
					break;
				case 0x56:  //Identnummer
					vds[Satz].Typ = "Identnummer";
					vds[Satz].Value = this.#getIdentnummer(sl, data.slice(offset, offset + sl));
					if (!this.#Id) {
						this.#Id = parseInt(vds[Satz].Value);
						this.emit('connect', { 'id': this.Identnummer, 'address': this.#AddressPort });
						let obj = this.#GetDevice(this.Identnummer, null);
						if (obj) {
							if (this.#KeyNr_rec != obj.keynr) {
								this.#logging(`Verbindung bei ${vds[Satz].Value} mit Schluesselnr:${this.#KeyNr_rec}, erwartet:${obj.keynr}`, 'warn');
							}
							this.#IdentnummerPruefen(this.Identnummer);
						} else {
							this.#logging(`Unbekannte Identnummer: ${this.Identnummer}`, 'warn');
						}
					}
					offset += sl;
					break;
				case 0x59:  //Gerätemerkmale
					vds[Satz].Typ = "Geraetemerkmale";
					let maxIndex = offset + sl;
					vds[Satz].Geraet = data.readUInt8(offset++);
					let laenge, typ, index, text;
					do {
						text = '';
						laenge = data.readUInt8(offset++);
						typ = data.readUInt8(offset++);
						index = data.readUInt8(offset++);
						switch (typ) {
							case 0: text = 'MAC-';
								break;
							case 1: text = 'IMEI-';
								break;
							case 2: text = 'SIM-Kartennummer-';
								break;
							case 3: text = 'Rufnummer-';
								break;
							case 0xff: text = 'herstellerspezifisch-';
								break;
						}
						switch (index) {
							case 1: text += 'Erstweg';
								break;
							case 2: text += 'Zweitweg';
								break;
						}
						text += ':';
						text += data.toString('latin1', offset, offset + laenge - 2);
						offset += laenge - 2;
					} while (offset < maxIndex);
					vds[Satz].Value = text;
					break;
				case 0x61:  //Transportdienstkennung
					vds[Satz].Typ = "Transportdienstkennung";
					switch (data.readUInt8(offset++)) {
						case 0x10: vds[Satz].Value = "Analoge Festverbindung";
							break;
						case 0x20: vds[Satz].Value = "Analoge Bedarfsgesteuerte Verbindung";
							break;
						case 0x30: vds[Satz].Value = "X.25 bzw. Datex-P";
							break;
						case 0x40: vds[Satz].Value = "ISDN, B-Kanal";
							break;
						case 0x50: vds[Satz].Value = "ISDN, D-Kanal";
							break;
						case 0x60: vds[Satz].Value = "Buendelfunk, Betriebsfunk";
							break;
						case 0x70: vds[Satz].Value = "Datenfunk";
							break;
						case 0x80: vds[Satz].Value = "Mobilfunk";
							break;
						case 0x90: vds[Satz].Value = "TCP/IP-Intranet-Uebertragung";
							break;
					}
					break;
				case 0x73:
					vds[Satz].Typ = "Telegrammzaehler";
					vds[Satz].Geraet = data.readUInt8(offset) >> 4 & 0x0F;
					vds[Satz].Bereich = data.readUInt8(offset++) & 0x0F;
					vds[Satz].Value = data.readUInt8(offset++);
					break;
				case 0xFF:  //Verbindung wird nicht mehr benötigt
					vds[Satz].Typ = "Verbindung wird nicht mehr benoetigt";
					offset += sl;
					break;
				default:
					offset += sl;
			}
		}
		return vds;
	}

	/**
	* Gibt die VdS Nutzdaten zurueck, inclusive das Laengenbyte
	* @returns {Buffer}
	*/
	#VdS2465_Zusammenstellen() {
		let buf_msg;

		buf_msg = this.#SendeSpeicher.shift();
		if (!this.#Stehend && this.#SendeSpeicher.length === 0) {
			buf_msg = Buffer.concat([buf_msg, this.#getTrennenBuffer()]);
		}
		let buf = Buffer.alloc(1);
		//L
		buf.writeUInt8(buf_msg.length, 0);
		return Buffer.concat([buf, buf_msg]);
	}

	//Empfangene Daten -> Laenge Prüfen
	#LaengePruefen(data) {
		if (data.length < 17) {
			this.#logging('Datensatz zu kurz (' + data.length.toString() + ')!', 'warn');
			return false;
		}
		let sl = data.readUInt16BE(2);
		if (data.length < (sl + 4)) {
			return false;
		}
		return true;
	}

	/**
	* Gibt Geraete-Datensatz zurueck
	* @param {String | null} Id Identnummer
	* @param {Number | null} KeyNr Keynummer
	* @returns {Object} Datensatz
	*/
	#GetDevice(Id, KeyNr) {
		let device = null;
		if (this.#KeyList.length > 0) {
			for (let i = 0; i < this.#KeyList.length; i++) {
				if (Id) {
					if (this.#KeyList[i].identnr === Id) {
						device = this.#KeyList[i];
						break;
					}
				} else if (KeyNr) {
					if (this.#KeyList[i].keynr === KeyNr) {
						device = this.#KeyList[i];
						break;
					}
				}
			}
		}
		return device;
	}

	#SchluesselPruefen(data) {
		this.#KeyNr_rec = data.readUInt16BE(0);

		if (this.#KeyNr_rec === 0) {
			return true;
		}

		let obj = this.#GetDevice(null, this.#KeyNr_rec);
		if(obj){
			this.#KeyNr = this.#KeyNr_rec;
			this.#Key = obj.key;
			this.#Stehend = obj.stehend;
			this.#UnbekannterKey = false;
			return true;
		}
		this.#UnbekannterKey = true;
		return false;
	}

	//Prueft die empfangene Identnummer mit der hinterlegten Identnummer
	#IdentnummerPruefen(id) {
		let obj = this.#GetDevice(id, null);
		if (obj) {
			this.#Stehend = obj.stehend;
			return true;
		}
		return false;
	}

	#Auswertung(data) {
		let offset = 2;
		this.#KeyNr_rec = data.readUInt16BE(0);
		this.#SL = data.readUInt16BE(offset);
 
		let buf = data.slice(4); //Kopf1 entfernen
		if (this.#KeyNr_rec > 0) {
			data = this.#Entschluesseln(buf);
			this.#logging('Antwort entschluesselt: ' + data.toString('hex'), 'silly');
		}
		else {
			data = buf;
		}
		offset = 0;
		if (this.#checkCRC16(data) === false) {
			this.#controller(_action.Checksummenfehler);
			return false;
		}

		this.#TC_rec = data.readUInt32BE(offset);
		offset += 4;

		offset += 2;	//CRC16

		this.#RC_rec = data.readUInt32BE(offset);
		offset += 4;

		this.#IK = data.readUInt8(offset++);
		this.#PK = data.readUInt8(offset++);
		this.#L = data.readUInt8(offset++);

		if ((13 + this.#L) > this.#SL) {
			this.#logging('Satzlaenge kleiner als Nutzdaten', 'warn');
			this.#controller(_action.Disconnect);
			return false;
		}

		if (this.#PK !== 1) {
			this.#logging('Protokoll nicht VdS2465 (PK)', 'warn');
			this.#controller(_action.IK6);
			return false;
		}

		if (this.#IK !== 1 && this.#IK !== 2 && this.#IK !== 7) {
			if ( ! this.#pruefeTelegrammZaehler()) {
				//this.#controller(_action.Disconnect);
				return false;
			}
		}
		this.#SendeZaehler = 0;

		switch (this.#IK) {
			case 1:
				return true;
				break;
			case 2:
				this.#controller(_action.IK3);
				return true;
				break;
			case 3:
				if (this.#SendeSpeicher.length > 0) {
					this.#controller(_action.IK4);
				} else {
					this.#controller(_action.IK3_nach_Pollzeit);
				}
				return true;
				break;
			case 4:
				this.#Inhalt = this.#VdS2465_Zerlegen(data.slice(offset, offset + this.#L));
				this.#logging(JSON.stringify(this.#Inhalt), 'debug');
				this.emit('data', this.#Inhalt);
				if (this.#VdSRequestCounter == 1) {
					this.#VdSRequestCounter++;
				}
				if (this.#SendeSpeicher.length > 0) {
					this.#controller(_action.IK4);
				} else {
					this.#controller(_action.IK3_nach_Pollzeit);
				}
				return true;
				break;
			case 5:
				this.#logging('Fehlermeldung: IK war unbekannt!', 'warn');
				this.#VdS2465_Zerlegen(data.slice(offset, offset + this.#L));
				break;
			case 6:
				this.#logging('Fehlermeldung: PK war unbekannt!', 'warn');
				this.#VdS2465_Zerlegen(data.slice(offset, offset + this.#L));
				break;
			case 7:
				//Wenn Zähler nicht stimmen!
				let i = this.#RC - 1;
				if (i < 0)
					i = 0xFFFFFFFF;
				if (this.#TC_rec !== i) {
					this.#logging(`IK7: Zaehler TC von ${this.#TC_rec.toString(16)} in ${i.toString(16)} geaendert!`, 'debug');
					this.#TC_rec = i;
				}
				this.#controller(_action.VdSServiceRequest);
				return true;
				break;
			default:
				this.#controller(_action.IK5);
				return true;
				break;
		}
		return false;
	}
}

module.exports = vds2465server;