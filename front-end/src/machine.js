/* @flow */

"use strict";

import * as xp_common from './common.js';
import * as Database from './database.js';
import React from 'react';

class Controller extends xp_common.Controller {
	machineName: string | void;
	machine: Parse.Object | void;

	constructor (machineName) {
		super ();
		this.machineName = machineName;
	}

	loadAsync () {
		Database.fetch ('machine?name=eq.' + this.machineName, true,
		objs => {
			this.machine = objs [0];
			this.allDataLoaded ();
		}, error => {
			alert ("error loading machine: " + error.toString ());
		});
	}

	allDataLoaded () {
		React.render (
			<div className="MachinePage">
				<xp_common.Navigation currentPage="" />
				<article>
					<xp_common.MachineDescription
						machine={this.machine} />
				</article>
			</div>,
			document.getElementById ('machinePage')
		);
	}
}

function started () {
	var machineId;
	if (window.location.hash)
		machineId = window.location.hash.substring (1);
	var controller = new Controller (machineId);
	controller.loadAsync ();
}

xp_common.start (started);
