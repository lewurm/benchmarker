/* @flow */

"use strict";

import * as xp_common from './common.js';
import * as xp_utils from './utils.js';
import React from 'react';

class Controller extends xp_common.Controller {

	configId: string | void;

	constructor (configId) {
		super ();
		this.configId = configId;
	}

	allDataLoaded () {
		React.render (
			<div className="ConfigPage">
				<xp_common.Navigation currentPage="" />
				<xp_common.ConfigDescription
					config={xp_utils.find (
						this.allConfigs,
						config => config.id === this.configId)} />
			</div>,
			document.getElementById ('configPage')
		);
	}

}

function started () {
	var configId;
	if (window.location.hash)
		configId = window.location.hash.substring (1);
	var controller = new Controller (configId);
	controller.loadAsync ();
}

xp_common.start (started);
