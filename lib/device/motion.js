/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceMotion {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.debug = platform.config.debug
    this.funcs = platform.funcs
    this.hapServ = platform.api.hap.Service
    this.hapChar = platform.api.hap.Characteristic
    this.eveChar = platform.eveChar
    this.log = platform.log
    this.messages = platform.messages

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Set up custom variables for this device type
    const deviceConf = platform.wemoMotions[device.serialNumber]
    this.noMotionTimer = deviceConf && deviceConf.noMotionTimer
      ? deviceConf.noMotionTimer
      : platform.consts.defaultValues.noMotionTimer
    this.disableDeviceLogging = deviceConf && deviceConf.overrideDisabledLogging
      ? false
      : platform.config.disableDeviceLogging

    // Add the motion sensor service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.MotionSensor) ||
      this.accessory.addService(this.hapServ.MotionSensor)

    // Pass the accessory to fakegato to setup the Eve info service
    this.accessory.historyService = new platform.eveService('motion', this.accessory, {
      log: platform.config.debugFakegato ? this.log : () => {}
    })

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({
        disableDeviceLogging: this.disableDeviceLogging,
        noMotionTimer: this.noMotionTimer
      })
      this.log('[%s] %s %s.', this.name, this.messages.devInitOpts, opts)
    }

    // A listener for when the device sends an update to the plugin
    this.client.on('BinaryState', attribute => this.receiveDeviceUpdate(attribute))
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
    const hkValue = attribute.value === 1
    this.externalUpdate(hkValue)
  }

  externalUpdate (value) {
    try {
      const prevState = this.service.getCharacteristic(this.hapChar.MotionDetected).value
      if ((value === prevState && !this.motionTimer) || (!value && this.motionTimer)) {
        return
      }
      if (value || this.noMotionTimer === 0) {
        if (this.motionTimer) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] timer stopped.', this.name)
          }
          clearTimeout(this.motionTimer)
          this.motionTimer = false
        }
        this.service.updateCharacteristic(this.hapChar.MotionDetected, value)
        this.accessory.historyService.addEntry({ status: value ? 1 : 0 })
        if (value) {
          const initialTime = this.accessory.historyService.getInitialTime()
          this.service.updateCharacteristic(
            this.eveChar.LastActivation,
            Math.round(new Date().valueOf() / 1000) - initialTime
          )
        }
        if (!this.disableDeviceLogging) {
          this.log(
            '[%s] motion sensor [%s].',
            this.name,
            value ? 'detected motion' : 'clear'
          )
        }
      } else {
        if (!this.disableDeviceLogging) {
          this.log('[%s] timer started [%d secs].', this.name, this.noMotionTimer)
        }
        clearTimeout(this.motionTimer)
        this.motionTimer = setTimeout(() => {
          this.service.updateCharacteristic(this.hapChar.MotionDetected, false)
          this.accessory.historyService.addEntry({ status: 0 })
          if (!this.disableDeviceLogging) {
            this.log('[%s] motion sensor [clear] - timer completed.', this.name)
          }
          this.motionTimer = false
        }, this.noMotionTimer * 1000)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }
}
