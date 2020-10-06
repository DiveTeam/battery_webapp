  
/*************************************************** 
 This is a React WebApp written to Flash an ESP32 via BLE
 
 Written by Andrew England (SparkFun)
 BSD license, all text above must be included in any redistribution.
 *****************************************************/
 
import React from 'react';
import Popup from 'react-popup';
import './App.css';

var myESP32 = 'd804b643-6ce7-4e81-9f8a-ce0f699085eb'

var otaServiceUuid = 'c8659210-af91-4ad3-a995-a58d6fd26145'
var versionCharacteristicUuid = 'c8659212-af91-4ad3-a995-a58d6fd26145'
var fileCharacteristicUuid = 'c8659211-af91-4ad3-a995-a58d6fd26145'


var service_voltages_uuid                = "0b040846-b145-4eed-8205-651afbe2c281"
var bluetooth_voltage_1_uuid             = "fbee111d-bdee-45c7-be4f-0844775b35f4"
var bluetooth_voltage_2_uuid             = "e97583c3-eef5-4bf9-b81c-953be0524693"
var bluetooth_voltage_3_uuid             = "65c9b4b3-0e0f-4cc2-aa89-70651a60f1f3"

var bluetooth_current_uuid               = "83fb85bf-dd0d-4d2e-94f8-e24a8bde5c96"
var bluetooth_temperature_uuid           = "d97dac03-775e-499e-8b0e-0878885ea732"

var service_uuid_history                 = "a25a9fc0-3d29-4940-9f7c-25be6a514f95"

var history_request_uuid                 = "bac531e3-a370-4f5c-91b0-78ab1ce7602d"
var characteristic_history_position_uuid = "67372646-059e-11eb-adc1-0242ac120002"
  
let esp32Device = null;
let esp32Service = null;
let esp32HistoryService = null;
let esp32BatteryService = null;
let esp32VoltagesService = null;
let readyFlagCharacteristic = null;
let dataToSend = null;
let updateData = null;

var totalSize;
var remaining;
var amountToWrite;
var currentPosition;

var bluetoothDevice;

var currentHardwareVersion = "N/A";
var softwareVersion = "N/A";
var latestCompatibleSoftware = "N/A";


var currentSOCCharacteristic;
var currentV1Characteristic;
var currentV2Characteristic;
var currentV3Characteristic;
var currentCurrentCharacteristic;
var currentTemperatureCharacteristic;

const characteristicSize = 512;



class SOC extends React.Component { render() { return ( <p>SOC: {this.props.soc}%</p> ); } }
class Temperature extends React.Component { render() { return ( <p>T: {this.props.temperature}˚C</p> ); } }
class Current extends React.Component { render() { return ( <p>I: {this.props.current}A</p> ); } }
class Voltage extends React.Component { render() { return ( <p>U{this.props.v_number}: {this.props.voltage}V</p> ); } }
class Wattage extends React.Component { render() { return ( <p>P: {this.props.wattage}W</p> ); } }
class Version extends React.Component { render() { return ( <p>{this.props.version_type}: {this.props.version}</p> ); } }

function PromptUserForUpdate(){
    Popup.create({
      content: "Version " + softwareVersion + " is out of date. Update to " + latestCompatibleSoftware + "?",
      buttons: {
          left: [{
              text: 'Yes',
              action: function () {
                fetch('https://raw.githubusercontent.com/DiveTeam/battery/main/releases/' + latestCompatibleSoftware + '.bin')
                .then(function (response) {
                  return response.arrayBuffer();
                })
                .then(function (data) {
                  Popup.close();
                  
                  updateData = data;
                  return SendFileOverBluetooth();
                })
                .catch(function (err) { console.warn('Something went wrong.', err); });
              }
          }],
          right: [{
              text: 'No',
              action: function () {
                Popup.close();
              }
          }]
      }
  })
}

/* SendFileOverBluetooth(data)
 * Figures out how large our update binary is, attaches an eventListener to our dataCharacteristic so the Server can tell us when it has finished writing the data to memory
 * Calls SendBufferedData(), which begins a loop of write, wait for ready flag, write, wait for ready flag...
 */
function SendFileOverBluetooth() {
  if(!esp32Service)
  {
    console.log("No esp32 Service");
    return;
  }

  totalSize = updateData.byteLength;
  remaining = totalSize;
  amountToWrite = 0;
  currentPosition = 0;
  esp32Service.getCharacteristic(fileCharacteristicUuid)
  .then(characteristic => {
    readyFlagCharacteristic = characteristic;
    return characteristic.startNotifications()
    .then(_ => {
      readyFlagCharacteristic.addEventListener('characteristicvaluechanged', SendBufferedData)
    });
  })
  .catch(error => { 
    console.log(error); 
  });
  SendBufferedData();
}


/* SendBufferedData()
 * An ISR attached to the same characteristic that it writes to, this function slices data into characteristic sized chunks and sends them to the Server
 */
function SendBufferedData() {
  if (remaining > 0) {
    if (remaining >= characteristicSize) {
      amountToWrite = characteristicSize
    }
    else {
      amountToWrite = remaining;
    }
    dataToSend = updateData.slice(currentPosition, currentPosition + amountToWrite);
    currentPosition += amountToWrite;
    remaining -= amountToWrite;
    console.log("remaining: " + remaining);
    esp32Service.getCharacteristic(fileCharacteristicUuid)
      .then(characteristic => RecursiveSend(characteristic, dataToSend))
      .then(_ => {
        console.log((100 * (currentPosition/totalSize)).toPrecision(3) + '%');
        return document.getElementById('completion').innerHTML = (100 * (currentPosition/totalSize)).toPrecision(3) + '%';
      })
      .catch(error => { 
        console.log(error); 
      });
  }
}


/* resursiveSend()
 * Returns a promise to itself to ensure data was sent and the promise is resolved.
 */
function RecursiveSend(characteristic, data) {
  return characteristic.writeValue(data)
  .catch(error => {
    return RecursiveSend(characteristic, data);
  });
}



class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      soc: 0,
      current: 0,
      temperature: 0,
      v1: 0,
      v2: 0,
      v3: 0,
      voltage: 0,
      wattage: 0,
      hw_version: "Not connected",
      sw_version: "Not connected"
    };
    this.BTConnect = this.BTConnect.bind(this);
  }

  updateVoltage(){
    this.setState({voltage: (Number(this.state.v1) + Number(this.state.v2) + Number(this.state.v3)).toFixed(3)});
    this.updateWattage();
  }

  updateWattage(){
    this.setState({wattage: (Number(this.state.voltage) * Number(this.state.current)).toFixed(1)});
  }

  BTConnect(){
    navigator.bluetooth.requestDevice({
      filters: [{
        services: [myESP32]
      }],
      optionalServices: [otaServiceUuid, service_voltages_uuid, 'battery_service', service_uuid_history]
    })
    .then(device => {
      bluetoothDevice = device;
      bluetoothDevice.addEventListener('gattserverdisconnected', this.onDisconnected);
      return device.gatt.connect()
    })
    .then(server => {
      server.getPrimaryService(service_voltages_uuid)
      .then( voltages_service => {
        esp32VoltagesService = voltages_service;

        esp32VoltagesService.getCharacteristic(bluetooth_voltage_1_uuid)
        .then(characteristic => {
          currentV1Characteristic = characteristic;
          currentV1Characteristic.addEventListener('characteristicvaluechanged',(event) => {
            this.setState({v1: event.target.value.getFloat32(0,1).toFixed(3)});
            this.updateVoltage();
          });
          currentV1Characteristic.startNotifications();
          currentV1Characteristic.readValue();
        });

        esp32VoltagesService.getCharacteristic(bluetooth_voltage_2_uuid)
        .then(characteristic => {
          currentV2Characteristic = characteristic;
          currentV2Characteristic.addEventListener('characteristicvaluechanged',(event) => {
            this.setState({v2: event.target.value.getFloat32(0,1).toFixed(3)});
            this.updateVoltage();
          });
          currentV2Characteristic.startNotifications();
          currentV2Characteristic.readValue();
        });

        esp32VoltagesService.getCharacteristic(bluetooth_voltage_3_uuid)
        .then(characteristic => {
          currentV3Characteristic = characteristic;
          currentV3Characteristic.addEventListener('characteristicvaluechanged',(event) => {
            this.setState({v3: event.target.value.getFloat32(0,1).toFixed(3)});
            this.updateVoltage();
          });
          currentV3Characteristic.startNotifications();
          currentV3Characteristic.readValue();
        });

        return voltages_service;
      })
      .catch(error => { console.log(error); });


      server.getPrimaryService('battery_service')
      .then( battery_service => {
        esp32BatteryService = battery_service;

        esp32BatteryService.getCharacteristic('battery_level')
        .then(characteristic => {
          currentSOCCharacteristic = characteristic;
          currentSOCCharacteristic.readValue();
          currentSOCCharacteristic.addEventListener('characteristicvaluechanged',(event) => {
            this.setState({soc: event.target.value.getUint8()});
          });
          currentSOCCharacteristic.startNotifications();
        });

        esp32BatteryService.getCharacteristic(bluetooth_current_uuid)
        .then(characteristic => {
          currentCurrentCharacteristic = characteristic;
          currentCurrentCharacteristic.readValue();
          currentCurrentCharacteristic.addEventListener('characteristicvaluechanged',(event) => {
            this.setState({current: event.target.value.getFloat32(0,1).toFixed(3)});
          });
          currentCurrentCharacteristic.startNotifications();
        });

        esp32BatteryService.getCharacteristic(bluetooth_temperature_uuid)
        .then(characteristic => {
          currentTemperatureCharacteristic = characteristic;
          currentTemperatureCharacteristic.readValue();
          currentTemperatureCharacteristic.addEventListener('characteristicvaluechanged',(event) => {
            this.setState({temperature: event.target.value.getFloat32(0,1).toFixed(1)});
          });
          currentTemperatureCharacteristic.startNotifications();
        });

        return battery_service;
      })
      .catch(error => { console.log(error); });

      return server.getPrimaryService(otaServiceUuid);
    })
    .then(service => {
      esp32Service = service;
    })
    .then(service => {
      return service;
    })
    .then(_ => {
      if(!esp32Service)
      {
        console.log("No service yet");
        return;
      }
      return esp32Service.getCharacteristic(versionCharacteristicUuid)
      .then(characteristic => characteristic.readValue())
      .then(value => {
        currentHardwareVersion = 'v' + value.getUint8(0) + '.' + value.getUint8(1);
        softwareVersion = 'v' + value.getUint8(2) + '.' + value.getUint8(3) + '.' + value.getUint8(4);
        this.setState({hw_version: currentHardwareVersion});
        this.setState({sw_version: softwareVersion});
      })
      //Grab our version numbers from Github
      .then(_ => fetch('https://raw.githubusercontent.com/DiveTeam/battery/main/releases/versions.json'))
      .then(response => response.json())
      .then(function (data) {
        // JSON should be formatted so that 0'th entry is the newest version
        if (latestCompatibleSoftware === softwareVersion)
        {
          //Software is updated, do nothing.
        }
        else {
          console.log("Checking for version");
          var softwareVersionCount = 0;
          latestCompatibleSoftware = data.firmware[softwareVersionCount]['software'];
          versionFindLoop:
            while (latestCompatibleSoftware !== undefined) {
              var compatibleHardwareVersion = "N/A"
              var hardwareVersionCount = 0;
              while (compatibleHardwareVersion !== undefined) {
                compatibleHardwareVersion = data.firmware[softwareVersionCount]['hardware'][hardwareVersionCount++];
                if (compatibleHardwareVersion === currentHardwareVersion)
                {
                  latestCompatibleSoftware = data.firmware[softwareVersionCount]['software'];
                  if (latestCompatibleSoftware === softwareVersion)
                  {
                    console.log(latestCompatibleSoftware);
                    PromptUserForUpdate();
                  }
                  break versionFindLoop;
                }
              }
              softwareVersionCount++;
            }
          }
      })
      .catch(error => { console.log(error); });

    })
    .catch(error => { console.log(error); });
  }

  onDisconnected(event) {
    alert("Bye-bye, reconnect is not yet supported :)");
  }

  componentWillMount() {
  }

  componentDidMount() {
  }

  componentWillUnmount() {
  }

  render() {
    return (
      <div className="App" id="top">
        <header className="App-header" id="mid">
          <Popup />
          <SOC soc={this.state.soc} />
          <Wattage wattage={this.state.wattage} />
          <Voltage v_number="" voltage={this.state.voltage} />
          <Current current={this.state.current} />
          <Temperature temperature={this.state.temperature} />
          <Voltage v_number="1" voltage={this.state.v1} />
          <Voltage v_number="2" voltage={this.state.v2} />
          <Voltage v_number="3" voltage={this.state.v3} />

          <Version version_type="Hardware" version={this.state.hw_version} />
          <Version version_type="Software" version={this.state.sw_version} />
          
          <p id="completion"></p>
          <button id="connect"onClick={this.BTConnect}>
            Connect to Bluetooth
          </button>
        </header>
      </div>
    );
  }
}
export default App;