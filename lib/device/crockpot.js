/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const entities = require('entities')
const helpers = require('./../helpers')
const xml2js = require('xml2js')
module.exports = class deviceCrockpot {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.device = device
    this.accessory = accessory
    this.client = accessory.client
    this.getAttributes()
    if (!this.accessory.context.cacheLastOnMode || this.accessory.context.cacheLastOnMode === 1) {
      this.accessory.context.cacheLastOnMode = 50
    }
    this.client.on('attributeList', (name, value, prevalue, timestamp) => {
      this.log.error('[%s] has changed attribute [%s] to [%s].', this.accessory.displayName, name, value)
    })
    this.modeLabels = {
      0: 'off',
      50: 'warm',
      51: 'low',
      52: 'high'
    }
  }

  async getAttributes () {
    try {
      const data = await this.client.soapAction('urn:Belkin:service:deviceevent:1', 'GetAttributes', null)
      const xml = '<attributeList>' + entities.decodeXML(data.attributeList) + '</attributeList>'
      const result = await xml2js.parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      for (const key in result.attributeList.attribute) {
        if (helpers.hasProperty(result.attributeList.attribute, key)) {
          const attribute = result.attributeList.attribute[key]
          attributes[attribute.name] = attribute.value
        }
      }
      this.log.error('---- crockpot getAttributes output ----')
      this.log.error(attributes)
      this.log.error('---- end crockpot getAttributes output ----')
    } catch (err) {
      this.log.warn('[%s] getAttributes error: %s.', this.accessory.displayName, this.debug ? '\n' + err : err.message)
    }
  }
}