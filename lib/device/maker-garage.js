/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceMakerGarage {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.debug = platform.config.debug
    this.funcs = platform.funcs
    this.hapServ = platform.api.hap.Service
    this.hapChar = platform.api.hap.Characteristic
    this.log = platform.log
    this.messages = platform.messages
    this.xml2js = platform.xml2js

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Set up custom variables for this device type
    const deviceConf = platform.wemoMakers[device.serialNumber]
    this.doorOpenTimer = deviceConf && deviceConf.makerTimer
      ? deviceConf.makerTimer
      : platform.consts.defaultValues.makerTimer
    this.disableDeviceLogging = deviceConf && deviceConf.overrideDisabledLogging
      ? false
      : platform.config.disableDeviceLogging

    // Set up the custom Eve characteristics for this device type
    this.eveRT = 'E863F112-079E-48FF-8F27-9C2605A29F52'
    this.eveLA = 'E863F11A-079E-48FF-8F27-9C2605A29F52'
    this.eveOD = 'E863F118-079E-48FF-8F27-9C2605A29F52'
    this.eveCD = 'E863F119-079E-48FF-8F27-9C2605A29F52'
    this.eveTO = 'E863F129-079E-48FF-8F27-9C2605A29F52'
    const self = this
    this.eveLastActivation = function () {
      self.hapChar.call(this, 'Last Activation', self.eveLA)
      this.setProps({
        format: self.hapChar.Formats.UINT32,
        unit: self.hapChar.Units.SECONDS,
        perms: [self.hapChar.Perms.READ, self.hapChar.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.eveResetTotal = function () {
      self.hapChar.call(this, 'Reset Total', self.eveRT)
      this.setProps({
        format: self.hapChar.Formats.UINT32,
        unit: self.hapChar.Units.seconds,
        perms: [
          self.hapChar.Perms.READ,
          self.hapChar.Perms.NOTIFY,
          self.hapChar.Perms.WRITE
        ]
      })
      this.value = this.getDefaultValue()
    }
    this.eveOpenDuration = function () {
      self.hapChar.call(this, 'Open Duration', self.eveOD)
      this.setProps({
        format: self.hapChar.Formats.UINT32,
        unit: self.hapChar.Units.SECONDS,
        perms: [
          self.hapChar.Perms.READ,
          self.hapChar.Perms.NOTIFY,
          self.hapChar.Perms.WRITE
        ]
      })
      this.value = this.getDefaultValue()
    }
    this.eveClosedDuration = function () {
      self.hapChar.call(this, 'Closed Duration', self.eveCD)
      this.setProps({
        format: self.hapChar.Formats.UINT32,
        unit: self.hapChar.Units.SECONDS,
        perms: [
          self.hapChar.Perms.READ,
          self.hapChar.Perms.NOTIFY,
          self.hapChar.Perms.WRITE
        ]
      })
      this.value = this.getDefaultValue()
    }
    this.eveTimesOpened = function () {
      self.hapChar.call(this, 'Times Opened', self.eveTO)
      this.setProps({
        format: self.hapChar.Formats.UINT32,
        perms: [self.hapChar.Perms.READ, self.hapChar.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    const inherits = require('util').inherits
    inherits(this.eveLastActivation, this.hapChar)
    inherits(this.eveResetTotal, this.hapChar)
    inherits(this.eveOpenDuration, this.hapChar)
    inherits(this.eveClosedDuration, this.hapChar)
    inherits(this.eveTimesOpened, this.hapChar)
    this.eveLastActivation.UUID = this.eveLA
    this.eveResetTotal.UUID = this.eveRT
    this.eveOpenDuration.UUID = this.eveOD
    this.eveClosedDuration.UUID = this.eveCD
    this.eveTimesOpened.UUID = this.eveTO

    // Some conversion objects
    this.gStates = {
      Open: 0,
      Closed: 1,
      Opening: 2,
      Closing: 3,
      Stopped: 4
    }

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // If the accessory has a contact sensor service then remove it
    if (this.accessory.getService(this.hapServ.ContactSensor)) {
      this.accessory.removeService(
        this.accessory.getService(this.hapServ.ContactSensor)
      )
    }

    // Add the garage door service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.GarageDoorOpener) ||
      this.accessory.addService(this.hapServ.GarageDoorOpener)

    // Add the Eve characteristics if they don't already exist
    if (!this.service.testCharacteristic(this.hapChar.ContactSensorState)) {
      this.service.addCharacteristic(this.hapChar.ContactSensorState)
    }
    if (!this.service.testCharacteristic(this.eveLastActivation)) {
      this.service.addCharacteristic(this.eveLastActivation)
    }
    if (!this.service.testCharacteristic(this.eveResetTotal)) {
      this.service.addCharacteristic(this.eveResetTotal)
    }
    if (!this.service.testCharacteristic(this.eveOpenDuration)) {
      this.service.addCharacteristic(this.eveOpenDuration)
    }
    if (!this.service.testCharacteristic(this.eveClosedDuration)) {
      this.service.addCharacteristic(this.eveClosedDuration)
    }
    if (!this.service.testCharacteristic(this.eveTimesOpened)) {
      this.service.addCharacteristic(this.eveTimesOpened)
    }
    this.timesOpened = this.service.getCharacteristic(this.eveTimesOpened).value
    this.service.getCharacteristic(this.eveResetTotal)
      .removeAllListeners('set')
      .on('set', (value, callback) => {
        callback()
        this.timesOpened = 0
        this.service.updateCharacteristic(this.eveTimesOpened, 0)
      })

    // Add the set handler to the target door state characteristic
    this.service.getCharacteristic(this.hapChar.TargetDoorState)
      .removeAllListeners('set')
      .on('set', this.internalDoorUpdate.bind(this))

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('door', this.accessory, {
      log: platform.config.debugFakegato ? this.log : () => {}
    })

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({
        disableDeviceLogging: this.disableDeviceLogging,
        makerTimer: this.doorOpenTimer
      })
      this.log('[%s] %s %s.', this.name, this.messages.devInitOpts, opts)
    }

    // A listener for when the device sends an update to the plugin
    this.client.on('AttributeList', attribute => this.receiveDeviceUpdate(attribute))

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log(
        '[%s] %s [%s: %s].',
        this.name,
        this.messages.recUpd,
        attribute.name,
        attribute.value
      )
    }
    switch (attribute.name) {
      case 'Switch': {
        if (attribute.value !== 0) {
          this.externalDoorUpdate()
        }
        break
      }
      case 'Sensor': {
        this.externalSensorUpdate(attribute.value, true)
        break
      }
    }
  }

  async sendDeviceUpdate (value) {
    await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'SetBinaryState',
      value
    )
  }

  async requestDeviceUpdate () {
    try {
      const data = await this.client.sendRequest(
        'urn:Belkin:service:deviceevent:1',
        'GetAttributes'
      )
      const decoded = this.funcs.decodeXML(data.attributeList)
      const xml = '<attributeList>' + decoded + '</attributeList>'
      const result = await this.xml2js.parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      for (const key in result.attributeList.attribute) {
        if (this.funcs.hasProperty(result.attributeList.attribute, key)) {
          const attribute = result.attributeList.attribute[key]
          attributes[attribute.name] = parseInt(attribute.value)
        }
      }
      if (attributes.SwitchMode === 0) {
        this.log.warn(
          '[%s] must be set to momentary mode to work as a garage door.',
          this.name
        )
        return
      }
      if (attributes.SensorPresent === 1) {
        this.sensorPresent = true
        this.externalSensorUpdate(attributes.Sensor)
      } else {
        this.sensorPresent = false
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.messages.rduErr, eText)
    }
  }

  async internalDoorUpdate (value, callback) {
    let prevTarget
    let prevCurrent
    try {
      prevTarget = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
      prevCurrent = this.service.getCharacteristic(this.hapChar.CurrentDoorState).value
      callback()
      if (this.isMoving) {
        if (value === this.gStates.Closed && prevCurrent === this.gStates.Closing) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already closing.', this.name)
          }
          return
        } else if (value === this.gStates.Open && prevCurrent === this.gStates.Opening) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already opening.', this.name)
          }
          return
        }
      } else {
        if (value === this.gStates.Closed && prevCurrent === this.gStates.Closed) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already closed.', this.name)
          }
          return
        } else if (value === this.gStates.Open && prevCurrent === this.gStates.Open) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already open.', this.name)
          }
          return
        }
      }
      this.homekitTriggered = true
      await this.sendDeviceUpdate({
        BinaryState: 1
      })
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting to [%s].', this.name, value ? 'close' : 'open')
      }
      this.setDoorMoving(value, true)
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.hapChar.TargetDoorState, prevTarget)
        this.service.updateCharacteristic(this.hapChar.CurrentDoorState, prevCurrent)
      } catch (e) {}
    }
  }

  externalDoorUpdate () {
    let state
    try {
      if (this.homekitTriggered) {
        this.homekitTriggered = false
        return
      }
      const target = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
      state = 1 - target
      if (!this.disableDeviceLogging) {
        this.log(
          '[%s] updating target state [%s] (triggered externally).',
          this.name,
          state === 1 ? 'closed' : 'open'
        )
      }
      this.service.updateCharacteristic(this.hapChar.TargetDoorState, state)
      if (state === 0) {
        // Door opened externally
        this.service.updateCharacteristic(this.hapChar.ContactSensorState, 1)
        this.accessory.eveService.addEntry({ status: 0 }) // swapped
        const initialTime = this.accessory.eveService.getInitialTime()
        this.service.updateCharacteristic(
          this.eveLastActivation,
          Math.round(new Date().valueOf() / 1000) - initialTime
        )
        this.timesOpened++
        this.service.updateCharacteristic(this.eveTimesOpened, this.timesOpened)
      }
      this.setDoorMoving(state)
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalSensorUpdate (state, wasTriggered) {
    // 0->1 and 1->0 reverse values to match HomeKit needs
    const value = 1 - state
    const target = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
    if (target === 0) {
      // CASE target is to OPEN
      if (value === 0) {
        // Garage door HK target state is OPEN and the sensor has reported OPEN
        if (this.isMoving) {
          // Garage door is in the process of opening
          this.service.updateCharacteristic(
            this.hapChar.CurrentDoorState,
            this.gStates.Opening
          )
          // for the contact sensor: 0 for contact and 1 for no contact
          // for the eve entry: 0 for contact and 1 for no contact
          this.service.updateCharacteristic(this.hapChar.ContactSensorState, 1)
          this.accessory.eveService.addEntry({ status: 0 }) // swapped
          const initialTime = this.accessory.eveService.getInitialTime()
          this.service.updateCharacteristic(
            this.eveLastActivation,
            Math.round(new Date().valueOf() / 1000) - initialTime
          )
          this.timesOpened++
          this.service.updateCharacteristic(this.eveTimesOpened, this.timesOpened)
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [opening].', this.name)
          }
        } else {
          // Garage door is open and not moving
          this.service.updateCharacteristic(
            this.hapChar.CurrentDoorState,
            this.gStates.Open
          )
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [open].', this.name)
          }
        }
      } else {
        // Garage door HK target state is OPEN and the sensor has reported CLOSED
        // Must have been triggered externally
        this.isMoving = false
        this.service.updateCharacteristic(
          this.hapChar.TargetDoorState,
          this.gStates.Closed
        )
        this.service.updateCharacteristic(
          this.hapChar.CurrentDoorState,
          this.gStates.Closed
        )
        // for the contact sensor: 0 for contact and 1 for no contact
        // for the eve entry: 0 for contact and 1 for no contact
        this.service.updateCharacteristic(this.hapChar.ContactSensorState, 0)
        this.accessory.eveService.addEntry({ status: 1 }) // swapped
        if (!this.disableDeviceLogging) {
          this.log(
            '[%s] updating current state [closed] (triggered externally).',
            this.name
          )
        }
      }
    } else {
      if (value === 1) {
        // Garage door HK target state is CLOSED and the sensor has reported CLOSED
        this.isMoving = false
        if (this.movingTimer) {
          clearTimeout(this.movingTimer)
          this.movingTimer = false
        }
        this.service.updateCharacteristic(
          this.hapChar.CurrentDoorState,
          this.gStates.Closed
        )
        // for the contact sensor: 0 for contact and 1 for no contact
        // for the eve entry: 0 for contact and 1 for no contact
        this.service.updateCharacteristic(this.hapChar.ContactSensorState, 0)
        this.accessory.eveService.addEntry({ status: 1 }) // swapped
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating current state [closed].', this.name)
        }
      } else {
        // Garage door HK target state is CLOSED but the sensor has reported OPEN
        // Must have been triggered externally
        this.service.updateCharacteristic(this.hapChar.TargetDoorState, this.gStates.Open)
        // for the contact sensor: 0 for contact and 1 for no contact
        // for the eve entry: 0 for contact and 1 for no contact
        this.service.updateCharacteristic(this.hapChar.ContactSensorState, 1)
        this.accessory.eveService.addEntry({ status: 0 }) // swapped
        const initialTime = this.accessory.eveService.getInitialTime()
        this.service.updateCharacteristic(
          this.eveLastActivation,
          Math.round(new Date().valueOf() / 1000) - initialTime
        )
        this.timesOpened++
        this.service.updateCharacteristic(this.eveTimesOpened, this.timesOpened)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating target state [open] (triggered externally).', this.name)
        }
        if (wasTriggered) {
          this.setDoorMoving(0)
        }
      }
    }
  }

  async setDoorMoving (targetDoorState, homekitTriggered) {
    if (this.movingTimer) {
      clearTimeout(this.movingTimer)
      this.movingTimer = false
    }
    if (this.isMoving) {
      this.isMoving = false
      this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 4)
      if (!this.disableDeviceLogging) {
        this.log('[%s] updating current state [stopped].', this.name)
      }
      // Toggle TargetDoorState after receiving a stop
      await this.funcs.sleep(500)
      this.service.updateCharacteristic(
        this.hapChar.TargetDoorState,
        targetDoorState === this.gStates.Open ? this.gStates.Closed : this.gStates.Open
      )
      return
    }
    this.isMoving = true
    if (homekitTriggered) {
      // CASE: triggered through HomeKit
      const curState = this.service.getCharacteristic(this.hapChar.CurrentDoorState).value
      if (targetDoorState === this.gStates.Closed) {
        // CASE: triggered through HomeKit and requested to CLOSE
        if (curState !== this.gStates.Closed) {
          this.service.updateCharacteristic(
            this.hapChar.CurrentDoorState,
            this.gStates.Closing
          )
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [closing].', this.name)
          }
        }
      } else {
        // CASE: triggered through HomeKit and requested to OPEN
        if (
          curState === this.gStates.Stopped ||
          (curState !== this.gStates.Open && !this.sensorPresent)
        ) {
          this.service.updateCharacteristic(
            this.hapChar.CurrentDoorState,
            this.gStates.Opening
          )
          // for the contact sensor: 0 for contact and 1 for no contact
          // for the eve entry: 0 for contact and 1 for no contact
          this.service.updateCharacteristic(this.hapChar.ContactSensorState, 1)
          this.accessory.eveService.addEntry({ status: 0 }) // swapped
          const initialTime = this.accessory.eveService.getInitialTime()
          this.service.updateCharacteristic(
            this.eveLastActivation,
            Math.round(new Date().valueOf() / 1000) - initialTime
          )
          this.timesOpened++
          this.service.updateCharacteristic(this.eveTimesOpened, this.timesOpened)
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [opening].', this.name)
          }
        }
      }
    }
    this.movingTimer = setTimeout(
      () => {
        this.movingTimer = false
        this.isMoving = false
        const target = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
        if (!this.sensorPresent) {
          this.service.updateCharacteristic(
            this.hapChar.CurrentDoorState,
            target === 1 ? this.gStates.Closed : this.gStates.Open
          )
          if (!this.disableDeviceLogging) {
            this.log(
              '[%s] updating current state [%s].',
              this.name,
              target === 1 ? 'closed' : 'open'
            )
          }
          return
        }
        if (target === 1) {
          // for the contact sensor: 0 for contact and 1 for no contact
          // for the eve entry: 0 for contact and 1 for no contact
          this.service.updateCharacteristic(this.hapChar.ContactSensorState, 0)
          this.accessory.eveService.addEntry({ status: 1 }) // swapped
        }
        this.requestDeviceUpdate()
      },
      this.doorOpenTimer * 1000
    )
  }
}
