const PagerDuty = require('node-pagerduty');
import * as WebRequest from 'web-request'

/** Start Config - Provide values for these.. */

// Your PagerDuty API key. Note this is your personal API key, NOT a service integration.
const PAGER_DUTY_API_KEY = ""

// The identifier of your service on PagerDuty.
const PAGER_DUTY_SERVICE = ""

// The email you use for PagerDuty.
const PAGER_DUTY_EMAIL = ""

// The local RPC URL to use. 
const LOCAL_API = "http://127.0.0.1:8080"

// The name of the node in the local API.
const LOCAL_NODE_NAME = "oasis-node"

// Amount of seconds allowed to be out of date before paging
const ACCEPTABLE_DELTA_SECS = 20 * 60 // 20 min

// Your Validator Address.
const VALIDATOR_ADDRESS = "1D9CB56367B3CD5C83529F02A2896D51C983219A"

// How often to run a health check.
const CHECK_INTERVAL_SECONDS = 30 // 30s

// How often to send a page for the same event.
const THROTTLE_INTERVAL_SECONDS = 5 * 60

// The number of times the process can error before it pages you. 
// This servers to stop users from accidentally getting if the oasis-node or oasis-api drop
// an API request or are unresponsive.
const ACCEPTABLE_CONSECUTIVE_FLAKES = 10 * (60 / CHECK_INTERVAL_SECONDS) // 10 minutes worth of misses at CHECK_INTERVAL_SECS

// How many blocks you can miss a precommit in before you are paged.
const ACCEPTABLE_CONSECUTIVE_MISS = 5 * (60 / CHECK_INTERVAL_SECONDS) // 5 precommits at CHECK_INTERVAL_SECS

/** End Config */

/**
 * The types returned from the API
 */
type ApiResponse = {
  result: ApiResult
}
type ApiResult = {
  height: number,
  round: number,
  block_id: BlockId,
  signatures: Array<Signature>
}
type BlockId = {
  hash: string,
  parts: any
}
type Signature = {
  block_id_flag: number,
  validator_address: string,
  timestamp: string,
  signature: string
}

let version = "0.0.2"

const HEADERS = { "headers": { "Content-Type": "application/json" } };

const pagerDutyClient = new PagerDuty(PAGER_DUTY_API_KEY);
const pagerDutyThrottle: Map<string, Date> = new Map();

let consecutiveMisses = 0
let consecutiveFlakes = 0

const monitor = async () => {
  console.log("Starting Oasis Health Monitor v" + version)

  while (true) {
    console.log("Running health check...")

    try {
      // Query local node for commits.
      console.log("> Fetching latest block from local API..")
      const commitUrl = LOCAL_API + "/api/consensus/blocklastcommit?name=" + LOCAL_NODE_NAME
      const commitResult = await WebRequest.get(commitUrl, HEADERS)
      if (commitResult.statusCode !== 200) {
        // Throw an error - this counts as a flake.
        throw new Error(`Local API is down! Code: ${commitResult.statusCode}: ${commitResult.content}`)
      }
      const commitData: ApiResponse = JSON.parse(commitResult.content)
      console.log("> Fetched successfully")

      // Grab block height for logging.
      const blockHeight = commitData.result.height
      console.log(`> Got result at height ${blockHeight}`)

      // Search through all commits to ensure that our validator signed it.
      console.log(`> Ensuring Validator signed block...`)
      let found = false
      let signatureTime: Date = new Date(0) // Unix epoch
      const signatures: Array<Signature> = commitData.result.signatures
      for (let i = 0; i < signatures.length; i++) {
        const signature = signatures[i]
        if (signature.validator_address === VALIDATOR_ADDRESS) {
          // Mark signature as found
          found = true

          // Capture time of signature
          signatureTime = new Date(Date.parse(signature.timestamp))
        }
      }
      if (found == true) {
        consecutiveMisses = 0
        console.log(`> Found signature for validator in block ${blockHeight} at ${signatureTime.toTimeString()}`)
      } else {
        consecutiveMisses++
        console.log("> Missed precommit in block " + blockHeight + ". Consecutive misses is now: " + consecutiveMisses)
      }

      // Page if precommit is missing.
      if (consecutiveMisses > ACCEPTABLE_CONSECUTIVE_MISS) {
        page("Missed Precommits", "Consecutive misses: " + consecutiveMisses, THROTTLE_INTERVAL_SECONDS, "missed-precommit")
        console.log("Health checks failed.")
        continue
      }

      // Make sure signature is recent.
      const now = new Date()
      console.log(`> Ensuring signature is recent(Current time ${now.toTimeString()})...`)
      const millisecondsPerSecond = 100
      const deltaSecs = Math.abs((now.getTime() - signatureTime.getTime()) / millisecondsPerSecond)
      console.log(`> Got a delta of ${deltaSecs} seconds`)
      if (deltaSecs > ACCEPTABLE_DELTA_SECS) {
        page("Noe is Lagging", `Lag is currnetly ${deltaSecs} seconds.`, THROTTLE_INTERVAL_SECONDS, "node-lag")
        console.log("Health checks failed.")
        continue
      }
      console.log("> Signature is recent")

      consecutiveFlakes = 0
      console.log("Health check passed.")
    } catch (e) {
      consecutiveFlakes++

      console.log("> Unknown error: " + e + ". Consecutive flakes is now: " + consecutiveFlakes)
      if (consecutiveFlakes >= ACCEPTABLE_CONSECUTIVE_FLAKES) {
        console.log("> Threshold exceeded. Paging.")
        page("Unknown error", e.message, 5 * 60, e.message)
        console.log("Health checks failed.")
      }
    }

    await sleep(CHECK_INTERVAL_SECONDS)
  }
}

/** Sleep for the given time. */
const sleep = async (seconds: number): Promise<void> => {
  const milliseconds = seconds * 1000
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** Page according to throttling rules. */
/** Stolen shamelessly from: https://gitlab.com/polychainlabs/celo-network-monitor */
const page = async (title, details, throttleSeconds = 60, alertKey) => {
  alertKey = alertKey || title + details

  if (shouldAlert(pagerDutyThrottle, alertKey, throttleSeconds)) {
    console.log(`> Paging: ${title}`)
    const payload = {
      incident: {
        title,
        type: 'incident',
        service: {
          id: PAGER_DUTY_SERVICE,
          type: 'service_reference',
        },
        body: {
          type: 'incident_body',
          details,
        },
        incident_key: alertKey,
      },
    };

    if (pagerDutyClient != undefined) {
      await pagerDutyClient.incidents.createIncident(PAGER_DUTY_EMAIL, payload)
    }
  }
}

/** Determine if we should page. */
/** Stolen shamelessly from: https://gitlab.com/polychainlabs/celo-network-monitor */
const shouldAlert = (throttle: Map<string, Date>, key: string, throttleSeconds: number): boolean => {
  if (!throttle.has(key)) {
    throttle.set(key, new Date());
    return true;
  }

  const now = new Date().getTime();
  const lastAlertTime = throttle.get(key)?.getTime() || 0;
  const secondsSinceAlerted = (now - lastAlertTime) / 1000;

  if (secondsSinceAlerted > throttleSeconds) {
    // We've passed our throttle delay period
    throttle.set(key, new Date());
    return true;
  }
  return false;
}

monitor()
