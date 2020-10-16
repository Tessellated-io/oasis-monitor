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

// How many blocks the nodes can be out sync before you are paged.
const ACCEPTABLE_LAG = 2

// How many blocks you can miss a precommit in before you are paged.
const ACCEPTABLE_CONSECUTIVE_MISS = 2

// Your Validator Address.
const VALIDATOR_ADDRESS = "1D9CB56367B3CD5C83529F02A2896D51C983219A"

// How often to run a health check.
const CHECK_INTERVAL_SECONDS = 5

// How often to send a page for the same event.
const THROTTLE_INTERVAL_SECONDS = 5 * 60

// The number of times the process can error before it pages you. 
// This servers to stop users from accidentally getting if the oasis-node or oasis-api drop
// an API request or are unresponsive.
const ACCEPTABLE_CONSECUTIVE_FLAKES = 3

/** End Config */

let version = "0.0.2"

const HEADERS = { "headers": { "Content-Type": "application/json" } };

const pagerDutyClient = new PagerDuty(PAGER_DUTY_API_KEY);
const pagerDutyThrottle: Map<string, Date> = new Map();

let consecutiveMisses = 0
let consecutiveFlakes = 0

const monitor = async () => {
  console.log("Starting Oasis Health Monitor v" + version)

  while (true) {
    console.log("Running Health Check!")

    try {
      // Query local node.
      const localUrl = LOCAL_API + "/api/consensus/block?name=" + LOCAL_NODE_NAME
      const localResult = await WebRequest.get(localUrl, HEADERS)
      if (localResult.statusCode !== 200) {
        page("Local API is down", `${localResult.statusCode}: ${localResult.content}`, THROTTLE_INTERVAL_SECONDS, `${localResult.statusCode}`)
        continue
      }

      // Query remote API.
      const remoteUrl = "https://api.oasismonitor.com/data/blocks?limit=1"
      const remoteResult = await WebRequest.get(remoteUrl, HEADERS)
      if (remoteResult.statusCode !== 200) {
        page("Local API is down", `${remoteResult.statusCode}: ${remoteResult.content}`, THROTTLE_INTERVAL_SECONDS, `${remoteResult.statusCode}`)
        continue
      }

      // Parse data.
      const localData = JSON.parse(localResult.content)
      const remoteData = JSON.parse(remoteResult.content)

      // Make sure any lag is within acceptable range. 
      const localHeight = localData.result.height
      const remoteHeight = remoteData[0].level
      const lag = Math.abs(localHeight - remoteHeight)
      console.log("Lag is " + lag)
      if (lag > ACCEPTABLE_LAG) {
        page("Node is lagging", "Local: " + localResult + ", Remote: " + remoteHeight, THROTTLE_INTERVAL_SECONDS, "lag")
        continue
      }

      // Query local node for commits.
      const commitUrl = LOCAL_API + "/api/consensus/blocklastcommit?name=" + LOCAL_NODE_NAME
      const commitResult = await WebRequest.get(commitUrl, HEADERS)
      if (localResult.statusCode !== 200) {
        page("Local API is down", `${localResult.statusCode}: ${localResult.content}`, THROTTLE_INTERVAL_SECONDS, `${localResult.statusCode}`)
        continue
      }
      const commitData = JSON.parse(commitResult.content)

      // Search through all commits to ensure that our validator signed it.
      let found = false
      const signatures = commitData.result.signatures
      for (let i = 0; i < signatures.length; i++) {
        const signature = signatures[i]
        if (signatures.validator_address === VALIDATOR_ADDRESS) {
          found = true
        }
      }
      if (found = true) {
        consecutiveMisses = 0
      } else {
        consecutiveMisses++
        console.log("Missed precommit in block " + remoteHeight + ". Consecutive misses is now: " + consecutiveMisses)
      }

      // Page if precommit is missing.
      if (consecutiveMisses > ACCEPTABLE_CONSECUTIVE_MISS) {
        page("Missed Precommits", "Consecutive misses: " + consecutiveMisses, THROTTLE_INTERVAL_SECONDS, "missed-precommit")
        continue
      }

      consecutiveFlakes = 0
      console.log("Health check passed.")
    } catch (e) {
      consecutiveFlakes++

      console.log("Unknown error: " + e + ". Consecutive flakes is now: " + consecutiveFlakes)
      if (consecutiveFlakes >= ACCEPTABLE_CONSECUTIVE_FLAKES) {
        page("Unknown error", e.message, 5 * 60, e.message)
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
    console.log(`Paging: ${title}`)
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
