///<reference path="../typings/react/react.d.ts"/>
///<reference path="../typings/react-dom/react-dom.d.ts"/>

/* @flow */

"use strict";

import * as xp_common from './common.tsx';
import * as xp_charts from './charts.tsx';
import * as Database from './database.ts';
import React = require ('react');
import ReactDOM = require ('react-dom');

class Controller {
	private pullRequestId: string;
	private dbRow: Object;
	private prRunSet: Database.DBRunSet;

	constructor (pullRequestId: string) {
		this.pullRequestId = pullRequestId;
	}

	public loadAsync () : void {
		Database.fetch ('pullrequest?pr_id=eq.' + this.pullRequestId,
		(objs: Array<Database.DBObject>) => {
			this.dbRow = objs [0];
			this.allDataLoaded ();
		}, (error: Object) => {
			alert ("error loading config: " + error.toString ());
		});
	}

	private allDataLoaded () : void {
        if (this.pullRequestId === undefined)
            return;
		if (this.dbRow === undefined)
			return;

        this.prRunSet = new Database.DBObject (this.dbRow, 'prrs_') as Database.DBRunSet;
        const pullRequest = new Database.DBObject (this.dbRow, 'pr_');
        const baselineRunSet = new Database.DBObject (this.dbRow, 'blrs_') as Database.DBRunSet;
		const machine = new Database.DBObject (this.dbRow, 'm_');
		const config = new Database.DBObject (this.dbRow, 'cfg_');

        var runSets = [baselineRunSet, this.prRunSet];

		// FIXME: metric
		ReactDOM.render (
			<div className="PullRequestPage">
				<xp_common.Navigation
					comparisonRunSetIds={ [baselineRunSet.get ('id'), this.prRunSet.get ('id')] }
					currentPage="" />
                <article>
					<div className="outer">
						<div className="inner">
							<PullRequestDescription
								pullRequest={pullRequest}
								baselineRunSet={baselineRunSet} />
							<xp_common.MachineDescription
								machine={machine}
								omitHeader={false} />
							<xp_common.ConfigDescription
								config={config}
								omitHeader={false} />
						</div>
					</div>
                    <xp_charts.ComparisonAMChart
                        graphName="comparisonChart"
                        runSets={runSets}
						metric="time"
                        runSetLabels={["Baseline", "Pull request"]}
						selectedIndices={[]}/>
					<div style={{ clear: 'both' }}></div>
					<h2>Pull Request Run Set</h2>
					<xp_common.RunSetDescription
						runSet={this.prRunSet} />
					<h2>Baseline Run Set</h2>
					<xp_common.RunSetDescription
						runSet={baselineRunSet} />
                </article>
			</div>,
			document.getElementById ('pullRequestPage')
		);
	}
}

interface PullRequestDescriptionProps {
	pullRequest: Database.DBObject;
	baselineRunSet: Database.DBObject;
}

interface PullRequestDescriptionState {
    gitHubInfo: Object;
}

class PullRequestDescription extends React.Component<PullRequestDescriptionProps, PullRequestDescriptionState> {
    constructor (props: PullRequestDescriptionProps) {
        super (props);
        this.state = { gitHubInfo: undefined };
		xp_common.getPullRequestInfo (
			this.props.pullRequest.get ('URL'),
			(info: Object) => this.setState ({ gitHubInfo: info })
		);
    }

	public render () : JSX.Element {
		var pr = this.props.pullRequest;
		var baselineRunSet = this.props.baselineRunSet;
        var info = this.state.gitHubInfo;

        var baselineHash = baselineRunSet.get ('commit');

        var title = <span>Loading&hellip;</span>;
        if (info !== undefined && info ['title'] !== undefined)
            title = info ['title'];

		var description = undefined;
		var commit = <a href={xp_common.githubCommitLink ('mono', baselineHash)}>{baselineHash.substring (0, 10)}</a>;
        if (info !== undefined && info ['user'] !== undefined) {
			var user = <a href={info ['user'] ["html_url"]}>{info ['user'] ['login']}</a>;
			description = <p>Authored by {user}, based on {commit}.</p>;
		} else {
			description = <p>Based on {commit}.</p>;
		}

		return <div className="Description">
			<h1><a href={pr.get ('URL')}>{title}</a></h1>
			{description}
		</div>;
	}
}

function start (params: Object) : void {
	var pullRequestId = params ['id'];
	if (pullRequestId === undefined) {
		alert ("Error: Please provide a pull request ID.");
		return;
	}
	var controller = new Controller (pullRequestId);
	controller.loadAsync ();
}

xp_common.parseLocationHashForDict (['id'], start);
