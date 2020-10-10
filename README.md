## Oasis Monitor

This is a simple typescript application to enable monitoring of a Oasis validator node from [Tessellated Geometry](https://tessellatedgeometry.com). 

It checks:
- If your node is lagging by `n` blocks versus the [Oasis Monitor API](https://oasismonitor.com/) 
- If your node is has missed `m` precommits in a row. 

If either condition occurs, it will send you a page via Pager Duty's API. 

## Setup 

- Install `npm` (or `yarn` if that's your thing).
- Run `npm i` to install dependencies.
- This software requires the [Oasis API](https://github.com/SimplyVC/oasis_api_server) server to be running on the machine.
- Retrieve your pager duty API token, pager duty service identifier, and pager duty email from [PagerDuty](http://pagerduty.com)
- Modify global variables in `src/monitor.ts` for the specifics of your setup. 
- Run `./start.sh`.

You'll likely need to do a bit of light customization to make this infrastructure suite your exact needs. PRs to generalize the software or extend functionality are welcome. 

Feel free to drop us a line on [Keybase](https://keybase.io/tessellatedgeo#_) or at [hello@tessellatedgeometry.com](mailto:hello@tessellatedgeometry.com) if you need help.

## Say Thanks

If this software is useful to you please consider [delegating to us](http://tessellatedgeometry.com/).
