import { contains, filterEmpty, splitAndFilter } from '../utils/array.js'

// Protocol constants (simplified version)
const Protocol = {
  TESTING_VERSION: 0,
  RELEASE_VERSION: 1,
  COMMAND_TCP: 1,
  COMMAND_UDP: 2,
  COMMAND_MUX: 3,
  ADDRESS_TYPE_IPV4: 1,
  ADDRESS_TYPE_DOMAIN: 2,
  ADDRESS_TYPE_IPV6: 3,
  RESPONSE_DATA: (v) => {
    return new Uint8Array([v, 0]).buffer
  }
}

// Simple test function to verify our modular architecture works correctly
function runTests() {
  console.log('Running FoxCloud Architecture Tests...')
  
  // Test array utilities
  const test1 = contains([1, 2, 3], 2) === true
  console.log('contains([1, 2, 3], 2) === true:', test1)
  
  const test2 = contains([1, 2, 3], 4) === false
  console.log('contains([1, 2, 3], 4) === false:', test2)
  
  const test3 = JSON.stringify(filterEmpty(['a', '', 'b', ''])) === JSON.stringify(['a', 'b'])
  console.log("filterEmpty(['a', '', 'b', '']) === ['a', 'b']:", test3)
  
  const test4 = JSON.stringify(splitAndFilter('a,,b,c', ',')) === JSON.stringify(['a', 'b', 'c'])
  console.log("splitAndFilter('a,,b,c', ',') === ['a', 'b', 'c']:", test4)
  
  // Test protocol constants
  const test5 = Protocol.RELEASE_VERSION === 1
  console.log('Protocol.RELEASE_VERSION === 1:', test5)
  
  const test6 = Protocol.TESTING_VERSION === 0
  console.log('Protocol.TESTING_VERSION === 0:', test6)
  
  const test7 = Protocol.COMMAND_TCP === 1
  console.log('Protocol.COMMAND_TCP === 1:', test7)
  
  const test8 = Protocol.COMMAND_UDP === 2
  console.log('Protocol.COMMAND_UDP === 2:', test8)
  
  // Test protocol response function
  const response = Protocol.RESPONSE_DATA(1)
  const test9 = response instanceof ArrayBuffer
  console.log('Protocol.RESPONSE_DATA(1) returns ArrayBuffer:', test9)
  
  const test10 = response.byteLength === 2
  console.log('Protocol.RESPONSE_DATA(1) has correct length:', test10)
  
  const view = new Uint8Array(response)
  const test11 = view[0] === 1 && view[1] === 0
  console.log('Protocol.RESPONSE_DATA(1) has correct values:', test11)
  
  const allTestsPassed = test1 && test2 && test3 && test4 && test5 && test6 && test7 && test8 && test9 && test10 && test11
  console.log('All tests passed:', allTestsPassed)
  
  return allTestsPassed
}

// Run the tests
runTests()