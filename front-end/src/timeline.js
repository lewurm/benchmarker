/* @flow */

"use strict";

import * as xp_common from './common.js';
import * as xp_utils from './utils.js';
import * as xp_charts from './charts.js';
import * as Database from './database.js';
import React from 'react';

class Controller {
	initialSelectionNames: { machineName: string | void, configName: string | void };
	initialZoom: boolean;
	runSetCounts: Array<Object>;

	constructor (machineName, configName) {
		if (machineName === undefined && configName === undefined) {
			machineName = 'benchmarker';
			configName = 'auto-sgen-noturbo';
			this.initialZoom = true;
		} else {
			this.initialZoom = false;
		}
		this.initialSelectionNames = { machineName: machineName, configName: configName };
	}

	loadAsync () {
		Database.fetchRunSetCounts (runSetCounts => {
			this.runSetCounts = runSetCounts;
			this.allDataLoaded ();
		}, error => {
			alert ("error loading run set counts: " + error.toString ());
		});
	}

	allDataLoaded () {
		var selection = Database.findRunSetCount (this.runSetCounts,
			this.initialSelectionNames.machineName,
			this.initialSelectionNames.configName);
		if (selection === undefined)
			selection = { machine: undefined, config: undefined };

		React.render (
			React.createElement (
				Page,
				{
					controller: this,
					initialSelection: selection,
					initialZoom: this.initialZoom,
					runSetCounts: this.runSetCounts,
					onChange: this.updateForSelection.bind (this)
				}
			),
			document.getElementById ('timelinePage')
		);

		this.updateForSelection (selection);
	}

	updateForSelection (selection) {
		var machine = selection.machine;
		var config = selection.config;
		if (machine === undefined || config === undefined)
			return;
		xp_common.setLocationForDict ({ machine: machine.get ('name'), config: config.get ('name') });
	}
}

class Page extends React.Component {
	constructor (props) {
		super (props);
		this.state = {
			machine: this.props.initialSelection.machine,
			config: this.props.initialSelection.config,
			zoom: this.props.initialZoom,
			runSetIndexes: [],
			sortedResults: [],
			benchmarkNames: []
		};
	}

	componentWillMount () {
		this.fetchSummaries (this.state);
	}

	runSetSelected (runSet, index) {
		this.setState ({runSetIndexes: this.state.runSetIndexes.concat ([index]), zoom: false});
	}

	allBenchmarksLoaded (names) {
		this.setState ({benchmarkNames: names});
	}

	fetchSummaries (selection) {
		var machine = selection.machine;
		var config = selection.config;

		if (machine === undefined || config === undefined)
			return;

		Database.fetchSummaries ('time', machine, config,
			objs => {
				objs.sort ((a, b) => {
					var aDate = a.runSet.commit.get ('commitDate');
					var bDate = b.runSet.commit.get ('commitDate');
					if (aDate.getTime () !== bDate.getTime ())
						return aDate - bDate;
					return a.runSet.get ('startedAt') - b.runSet.get ('startedAt');
				});

				this.setState ({sortedResults: objs});
			}, error => {
				alert ("error loading summaries: " + error.toString ());
			});
	}

	selectionChanged (selection) {
		var machine = selection.machine;
		var config = selection.config;

		this.setState ({machine: machine, config: config, sortedResults: [], benchmarkNames: [], zoom: false});
		this.fetchSummaries (selection);
		this.props.onChange (selection);
	}

	render () {
		var chart;
		var benchmarkChartList;
		var selected = this.state.machine !== undefined && this.state.config !== undefined;

		if (selected) {
			var zoomInterval;
			if (this.state.zoom)
				zoomInterval = { start: 6, end: this.state.sortedResults.length };
			chart = <AllBenchmarksChart
				graphName={'allBenchmarksChart'}
				machine={this.state.machine}
				config={this.state.config}
				sortedResults={this.state.sortedResults}
				zoomInterval={zoomInterval}
				runSetSelected={this.runSetSelected.bind (this)}
				allBenchmarksLoaded={this.allBenchmarksLoaded.bind (this)}
				/>;
			benchmarkChartList = <BenchmarkChartList
				benchmarkNames={this.state.benchmarkNames}
				machine={this.state.machine}
				config={this.state.config}
				sortedResults={this.state.sortedResults}
				runSetSelected={this.runSetSelected.bind (this)}
				/>;
		} else {
			chart = <div className="DiagnosticBlock">Please select a machine and config.</div>;
		}

		var runSetIndexes = this.state.runSetIndexes;
		var runSets = runSetIndexes.map (i => this.state.sortedResults [i].runSet);

		var comparisonChart;
		if (runSets.length > 1) {
			comparisonChart = <xp_charts.ComparisonAMChart graphName="comparisonChart"
				runSets={runSets} />;
		}

		var runSetSummaries;
		if (runSetIndexes.length > 0) {
			var divs = runSetIndexes.map (i => {
				var rs = this.state.sortedResults [i].runSet;
				var prev = i > 0 ? this.state.sortedResults [i - 1].runSet : undefined;
				return <RunSetSummary runSet={rs} previousRunSet={prev} />;
			});
			runSetSummaries = <div className="RunSetSummaries">{divs}</div>;
		}

		return <div className="TimelinePage">
			<xp_common.Navigation currentPage="timeline" />
			<article>
				<div className="outer">
					<div className="inner">
						<xp_common.CombinedConfigSelector
							runSetCounts={this.props.runSetCounts}
							machine={this.state.machine}
							config={this.state.config}
							onChange={this.selectionChanged.bind (this)}
							showControls={false} />
						<xp_common.MachineDescription
							machine={this.state.machine}
							omitHeader={true} />
						<xp_common.ConfigDescription
							config={this.state.config}
							omitHeader={true} />
					</div>
				</div>
				{chart}
				<div style={{ clear: 'both' }}></div>
				{runSetSummaries}
				<div style={{ clear: 'both' }}></div>
				{comparisonChart}
				{benchmarkChartList}
			</article>
		</div>;
	}
}

type RunSetSummaryProps = {
	runSet: Database.DBRunSet;
	previousRunSet: Database.DBRunSet | void;
}

class RunSetSummary extends React.Component<RunSetSummaryProps, RunSetSummaryProps, void> {
	render () : Object {
		var runSet = this.props.runSet;
		var commitHash = runSet.commit.get ('hash');
		var commitLink = xp_common.githubCommitLink (commitHash);

		var prev = this.props.previousRunSet;
		var prevItems;
		if (prev !== undefined) {
			var prevHash = prev.commit.get ('hash');
			var prevLink = xp_common.githubCommitLink (prevHash);
			var compareLink = xp_common.githubCompareLink (prevHash, commitHash);
			prevItems = [<dt>Previous</dt>,
				<dd><a href={prevLink}>{prevHash.substring (0, 10)}</a><br /><a href={compareLink}>Compare</a></dd>];
		}

		var runSetLink = "runset.html#id=" + runSet.get ('id');
		return <div className="RunSetSummary">
			<div className="Description">
			<dl>
			<dt>Commit</dt>
			<dd><a href={commitLink}>{commitHash.substring (0, 10)}</a><br /><a href={runSetLink}>Details</a></dd>
			{prevItems}
			</dl>
			</div>
			</div>;
	}
}

export function joinBenchmarkNames (benchmarks: (Array<string> | void), prefix: string) : string {
	if (benchmarks === undefined || benchmarks.length === 0)
		return "";
	return prefix + benchmarks.join (", ");
}

function tooltipForRunSet (runSet: Database.DBRunSet, includeBroken: boolean) {
	var commit = runSet.commit;
	var commitDateString = commit.get ('commitDate').toDateString ();
	var branch = "";
	if (commit.get ('branch') !== undefined)
		branch = " (" + commit.get ('branch') + ")";
	var startedAtString = runSet.get ('startedAt').toDateString ();
	var hashString = commit.get ('hash').substring (0, 10);

	var tooltip = hashString + branch + "\nCommitted on " + commitDateString + "\nRan on " + startedAtString;
	if (includeBroken) {
		var timedOutBenchmarks = joinBenchmarkNames (runSet.get ('timedOutBenchmarks'), "\nTimed out: ");
		var crashedBenchmarks = joinBenchmarkNames (runSet.get ('crashedBenchmarks'), "\nCrashed: ");
	 	tooltip = tooltip + timedOutBenchmarks + crashedBenchmarks;
	}
	return tooltip;
}

type BenchmarkValueArray = Array<{ [benchmark: string]: number }>;

function runSetIsBroken (runSet: Database.DBObject, averages: BenchmarkValueArray) {
	var timedOutBenchmarks = runSet.get ('timedOutBenchmarks') || [];
	var crashedBenchmarks = runSet.get ('crashedBenchmarks') || [];
	var timedOutOrCrashedBenchmarks = timedOutBenchmarks.concat (crashedBenchmarks);
	for (var i = 0; i < timedOutOrCrashedBenchmarks.length; ++i) {
		var benchmark = timedOutOrCrashedBenchmarks [i];
		if (!(benchmark in averages))
			return true;
	}
	return false;
}

type TimelineChartProps = {
	graphName: string;
	machine: Database.DBObject;
	config: Database.DBObject;
	benchmark: string;
	sortedResults: Array<{ runSet: Database.DBRunSet, averages: BenchmarkValueArray, variances: BenchmarkValueArray }>;
	zoomInterval: void | {start: number, end: number};
	runSetSelected: (runSet: Database.DBObject) => void;
};

class TimelineChart extends React.Component<TimelineChartProps, TimelineChartProps, void> {
	table : void | Array<Object>;

	valueAxisTitle () : string {
		return "";
	}

	componentWillMount () {
		this.invalidateState (this.props);
	}

	componentWillReceiveProps (nextProps) {
		if (this.props.machine === nextProps.machine && this.props.config === nextProps.config && this.props.sortedResults === nextProps.sortedResults)
			return;
		this.invalidateState (nextProps);
	}

	render () {
		if (this.table === undefined)
			return <div className="diagnostic">Loading&hellip;</div>;

		return <xp_charts.TimelineAMChart
			graphName={this.props.graphName}
			height={300}
			data={this.table}
			zoomInterval={this.props.zoomInterval}
			title={this.valueAxisTitle ()}
			selectListener={this.props.runSetSelected.bind (this)} />;
	}

	computeTable (nextProps) {
	}

	invalidateState (nextProps) {
		this.table = undefined;
		this.computeTable (nextProps);
		//this.forceUpdate ();
	}
}

class AllBenchmarksChart extends TimelineChart {
	valueAxisTitle () : string {
		return "Relative wall clock time";
	}

	computeTable (nextProps) {
		var results = nextProps.sortedResults;
		var i = 0, j = 0;

		/* A table of run data. The rows are indexed by benchmark index, the
		 * columns by sorted run set index.
		 */
		var runMetricsTable : Array<Array<number>> = [];

		/* Get a row index from a benchmark ID. */
		var benchmarkIndicesByName = {};
		var benchmarkNamesByIndices = [];
		/* Compute the mean elapsed time for each. */
		for (i = 0; i < results.length; ++i) {
			var row = results [i];
			var averages = row.averages;
			for (var name in averages) {
				var index = benchmarkIndicesByName [name];
				if (index === undefined) {
					index = Object.keys (benchmarkIndicesByName).length;
					runMetricsTable.push ([]);
					benchmarkIndicesByName [name] = index;
					benchmarkNamesByIndices [index] = name;
				}

				var avg = averages [name];
				if (avg === undefined)
					continue;
				runMetricsTable [index] [i] = avg;
			}
		}

		/* Compute the average time for a benchmark, and normalize times by
		 * it, i.e., in a given run set, a given benchmark took some
		 * proportion of the average time for that benchmark.
		 */
		for (i = 0; i < runMetricsTable.length; ++i) {
			var filtered = runMetricsTable [i].filter (x => !isNaN (x));
			var normal = filtered.reduce ((sumSoFar, time) => sumSoFar + time, 0) / filtered.length;
			runMetricsTable [i] = runMetricsTable [i].map (time => time / normal);
		}

		var table = [];

		for (j = 0; j < results.length; ++j) {
			var runSet = results [j].runSet;
			var prodForRunSet = 1.0;
			var count = 0;
			var min = undefined;
			var minName = undefined;
			var max = undefined;
			var maxName = undefined;
			for (i = 0; i < runMetricsTable.length; ++i) {
				var val = runMetricsTable [i] [j];
				if (isNaN (val))
					continue;
				prodForRunSet *= val;
				if (min === undefined || val < min) {
					min = val;
					minName = benchmarkNamesByIndices [i];
				}
				if (max === undefined || val > max) {
					max = val;
					maxName = benchmarkNamesByIndices [i];
				}
				++count;
			}
			if (count === 0) {
				console.log ("No data for run set " + runSet.get ('id'));
				continue;
			}
			var tooltip = tooltipForRunSet (runSet, true);
			var broken = runSetIsBroken (runSet, results [j].averages);
			table.push ({
				dataItem: runSet,
				low: min,
				lowName: minName ? ("Fastest: " + minName) : undefined,
				high: max,
				highName: maxName ? ("Slowest: " + maxName) : undefined,
				geomean: Math.pow (prodForRunSet, 1.0 / count),
				tooltip: tooltip,
				lineColor: (broken ? xp_common.xamarinColors.red [2] : xp_common.xamarinColors.blue [2])
			});
		}

		this.table = table;

		if (nextProps.allBenchmarksLoaded !== undefined)
			nextProps.allBenchmarksLoaded (benchmarkNamesByIndices);
	}
}

function formatDuration (t: number) : string {
	return (t / 1000).toPrecision (4) + "s";
}

class BenchmarkChart extends TimelineChart {
	valueAxisTitle () : string {
		return "Wall clock time";
	}

	computeTable (nextProps) {
		var results = nextProps.sortedResults;
		var j = 0;

		var table = [];

		for (j = 0; j < results.length; ++j) {
			var runSet = results [j].runSet;
			var average = results [j].averages [nextProps.benchmark];
			var variance = results [j].variances [nextProps.benchmark];
			if (average === undefined)
				continue;

			var tooltip = tooltipForRunSet (runSet, false);

			var low = undefined;
			var high = undefined;
			var averageTooltip;
			if (variance !== undefined) {
				var stdDev = Math.sqrt (variance);
				low = average - stdDev;
				high = average + stdDev;
				averageTooltip = "Average +/- standard deviation: " + formatDuration (low) + "–" + formatDuration (high);
			} else {
				averageTooltip = "Average: " + formatDuration (average);
			}
			table.push ({
				dataItem: runSet,
				geomean: average,
				low: low,
				high: high,
				tooltip: tooltip + "\n" + averageTooltip
			});
		}

		this.table = table;
	}
}

class BenchmarkChartList extends React.Component {
	constructor (props) {
		super (props);
		this.state = { isExpanded: false };
	}

	render () {
		if (!this.state.isExpanded) {
			return <div className="BenchmarkChartList">
				<button onClick={this.expand.bind (this)}>Show Benchmarks</button>
			</div>;
		}

		var benchmarks = this.props.benchmarkNames.slice ();
		benchmarks.sort ();
		var charts = benchmarks.map (name => {
			var key = 'benchmarkChart_' + name;
			return <div key={key} className="BenchmarkChartList">
				<h3>{name}</h3>
				<BenchmarkChart
					graphName={key}
					sortedResults={this.props.sortedResults}
					machine={this.props.machine}
					config={this.props.config}
					benchmark={name}
					runSetSelected={this.props.runSetSelected}
					/>
				</div>;
		});

		return <div>{charts}</div>;
	}

	expand () {
		this.setState ({ isExpanded: true });
	}
}

function start (params) {
	var machine = params ['machine'];
	var config = params ['config'];
	var controller = new Controller (machine, config);
	controller.loadAsync ();
}

xp_common.parseLocationHashForDict (['machine', 'config'], start);
