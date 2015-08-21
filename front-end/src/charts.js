/* @flow */

/* global AmCharts */

"use strict";

import * as xp_common from './common.js';
import * as xp_utils from './utils.js';
import {Parse} from 'parse';
import React from 'react';

type Range = [number, number, number, number];

function calculateRunsRange (runs: Array<Parse.Object>): Range {
	var min: number | void;
	var max: number | void;
	var sum = 0;
	for (var i = 0; i < runs.length; ++i) {
		var v = runs [i].get ('elapsedMilliseconds');
		if (min === undefined || v < min)
			min = v;
		if (max === undefined || v > max)
			max = v;
		sum += v;
	}
	var mean = sum / runs.length;
    sum = 0;
    for (i = 0; i < runs.length; ++i) {
        var v = runs [i].get ('elapsedMilliseconds');
        var diff = v - mean;
        sum += diff * diff;
    }
    var stddev = Math.sqrt (sum) / runs.length;
	if (min === undefined || max === undefined)
		min = max = 0;
	return [min, mean - stddev, mean + stddev, max];
}

function normalizeRange (mean: number, range: Range) : Range {
	return range.map (x => x / mean);
}

function rangeMean (range: Range) : number {
	return (range [1] + range [2]) / 2;
}

type BenchmarkRow = [string, Array<Range>];
type DataArray = Array<BenchmarkRow>;

function dataArrayForRunSets (controller: xp_common.Controller, runSets: Array<Parse.Object>, runsByIndex : Array<Array<Parse.Object>>): (DataArray | void) {
    for (var i = 0; i < runSets.length; ++i) {
        if (runsByIndex [i] === undefined)
            return undefined;
    }

    console.log ("all runs loaded");

    var commonBenchmarkIds;

    for (i = 0; i < runSets.length; ++i) {
        var runs = runsByIndex [i];
        var benchmarkIds = xp_utils.uniqStringArray (runs.map (o => o.get ('benchmark').id));
        if (commonBenchmarkIds === undefined) {
            commonBenchmarkIds = benchmarkIds;
            continue;
        }
        commonBenchmarkIds = xp_utils.intersectArray (benchmarkIds, commonBenchmarkIds);
    }

    if (commonBenchmarkIds === undefined || commonBenchmarkIds.length === 0)
        return;

	commonBenchmarkIds = xp_utils.sortArrayLexicographicallyBy (commonBenchmarkIds, id => controller.benchmarkNameForId (id));

    var dataArray = [];

    for (i = 0; i < commonBenchmarkIds.length; ++i) {
        var benchmarkId = commonBenchmarkIds [i];
        var row = [controller.benchmarkNameForId (benchmarkId), []];
        var mean = undefined;
        for (var j = 0; j < runSets.length; ++j) {
            var filteredRuns = runsByIndex [j].filter (r => r.get ('benchmark').id === benchmarkId);
            var range = calculateRunsRange (filteredRuns);
            if (mean === undefined)
				mean = rangeMean (range);
			row [1].push (normalizeRange (mean, range));
        }
        dataArray.push (row);
    }

    return dataArray;
}

function rangeInBenchmarkRow (row: BenchmarkRow, runSetIndex: number) : Range {
	return row [1] [runSetIndex];
}

// FIXME: use geometric mean
function runSetMean (dataArray: DataArray, runSetIndex: number) : number {
	var sum = 0;
	for (var i = 0; i < dataArray.length; ++i) {
		var range = rangeInBenchmarkRow (dataArray [i], runSetIndex);
		sum += rangeMean (range);
	}
	return sum / dataArray.length;
}

function sortDataArrayByDifference (dataArray: DataArray, runSets: Array<Parse.Object>) : DataArray {
	var differences = {};
	for (var i = 0; i < dataArray.length; ++i) {
		var row = dataArray [i];
		var min = Number.MAX_VALUE;
		var max = Number.MIN_VALUE;
		for (var j = 0; j < runSets.length; ++j) {
			var avg = rangeMean (rangeInBenchmarkRow (row, j));
			if (min === undefined)
				min = avg;
			else
				min = Math.min (min, avg);
			if (max === undefined)
				max = avg;
			else
				max = Math.max (max, avg);
		}
		differences [row [0]] = max - min;
	}
	return xp_utils.sortArrayNumericallyBy (dataArray, row => -differences [row [0]]);
}

function runSetLabels (controller: xp_common.Controller, runSets: Array<Parse.Object>) : Array<string> {
    var commitIds = runSets.map (rs => rs.get ('commit').id);
    var commitHistogram = xp_utils.histogramOfStrings (commitIds);

    var includeCommit = commitHistogram.length > 1;

    var includeStartedAt = false;
    for (var i = 0; i < commitHistogram.length; ++i) {
        if (commitHistogram [i] [1] > 1)
            includeStartedAt = true;
    }

    var machineIds = runSets.map (rs => rs.get ('machine').id);
    var includeMachine = xp_utils.uniqStringArray (machineIds).length > 1;

    var configIds = runSets.map (rs => rs.get ('config').id);
    var includeConfigs = xp_utils.uniqStringArray (configIds).length > 1;

    var formatRunSet = runSet => {
        var str = "";
        if (includeCommit) {
            var commit = runSet.get ('commit');
            str = commit.get ('hash') + " (" + commit.get ('commitDate') + ")";
        }
        if (includeMachine) {
            var machine = controller.machineForId (runSet.get ('machine').id);
            if (str !== "")
                str = str + "\n";
            str = str + machine.get ('name');
        }
        if (includeConfigs) {
            var config = controller.configForId (runSet.get ('config').id);
            if (includeMachine)
                str = str + " / ";
            else if (str !== "")
                str = str + "\n";
            str = str + config.get ('name');
        }
        if (includeStartedAt) {
            if (str !== "")
                str = str + "\n";
            str = str + runSet.get ('startedAt');
        }
        return str;
    };

    return runSets.map (formatRunSet);
}

type AMChartProps = {
	graphName: string;
	height: number;
	options: Object;
	selectListener: (index: number) => void;
    initFunc: ((chart: AmChart) => void) | void;
};

export class AMChart extends React.Component<AMChartProps, AMChartProps, void> {
	chart: Object;

	render () {
		return React.DOM.div({
			className: 'AMChart',
			id: this.props.graphName,
			style: {height: this.props.height}
		});
	}

	componentDidMount () {
		console.log ("mounting chart");
		this.drawChart (this.props);
	}

	componentWillUnmount () {
		console.log ("unmounting chart");
		this.chart.clear ();
	}

	shouldComponentUpdate (nextProps : AMChartProps, nextState : void) : boolean {
		if (this.props.graphName !== nextProps.graphName)
			return true;
		if (this.props.height !== nextProps.height)
			return true;
		if (this.props.options !== nextProps.options)
			return true;
		// FIXME: what do we do with the selectListener?
		return false;
	}

	componentDidUpdate () {
		this.drawChart (this.props);
	}

	drawChart (props : AMChartProps) {
		console.log ("drawing");
		if (this.chart === undefined) {
			this.chart = AmCharts.makeChart (props.graphName, props.options);
			if (this.props.selectListener !== undefined)
				this.chart.addListener (
					'clickGraphItem',
					e => this.props.selectListener (e.item.dataContext.runSet));
            if (this.props.initFunc !== undefined)
                this.props.initFunc (this.chart);
		} else {
            this.chart.graphs = this.props.options.graphs;
            this.chart.dataProvider = this.props.options.dataProvider;
			var valueAxis = this.props.options.valueAxes [0];
			if (valueAxis.minimum !== undefined) {
	            this.chart.valueAxes [0].minimum = valueAxis.minimum;
	            this.chart.valueAxes [0].maximum = valueAxis.maximum;
			}
			if (valueAxis.guides !== undefined)
				this.chart.valueAxes [0].guides = valueAxis.guides;
			this.chart.validateData ();
            if (this.props.initFunc !== undefined)
                this.props.initFunc (this.chart);
		}
	}
}

function formatPercentage (x: number) : string {
    return (x * 100).toPrecision (4) + "%";
}

type ComparisonAMChartProps = {
    runSets: Array<Parse.Object>;
	runSetLabels: Array<string> | void;
	graphName: string;
    controller: xp_common.Controller;
};

export class ComparisonAMChart extends React.Component<ComparisonAMChartProps, ComparisonAMChartProps, void> {
    runsByIndex : Array<Array<Parse.Object>>;
    graphs: Array<Object>;
    dataProvider: Array<Object>;
    min: number | void;
    max: number | void;
	guides: Array<Object>;

    constructor (props : ComparisonAMChartProps) {
        super (props);

        this.invalidateState (props.runSets);
    }

    componentWillReceiveProps (nextProps : ComparisonAMChartProps) {
		this.invalidateState (nextProps.runSets);
	}

    invalidateState (runSets : Array<Parse.Object>) : void {
        this.runsByIndex = [];

        xp_common.pageParseQuery (
            () => {
                var query = new Parse.Query (xp_common.Run);
                query.containedIn ('runSet', runSets);
                return query;
            },
            results => {
                if (this.props.runSets !== runSets)
                    return;

                var runSetIndexById = {};
                runSets.forEach ((rs, i) => {
                    this.runsByIndex [i] = [];
                    runSetIndexById [rs.id] = i;
                });

                results.forEach (r => {
                    var i = runSetIndexById [r.get ('runSet').id];
                    if (this.runsByIndex [i] === undefined)
                        this.runsByIndex [i] = [];
                    this.runsByIndex [i].push (r);
                });

                this.runsLoaded ();
            },
            function (error) {
                alert ("error loading runs: " + error.toString ());
            });
    }

    runsLoaded () {
        var i;

        console.log ("run loaded");

        var dataArray = dataArrayForRunSets (this.props.controller, this.props.runSets, this.runsByIndex);
        if (dataArray === undefined)
            return;

		dataArray = sortDataArrayByDifference (dataArray, this.props.runSets);

        var graphs = [];
		var guides = [];
        var dataProvider = [];

        var labels = this.props.runSetLabels || runSetLabels (this.props.controller, this.props.runSets);

        for (var i = 0; i < this.props.runSets.length; ++i) {
            var runSet = this.props.runSets [i];
			var label = labels [i];
			var avg = runSetMean (dataArray, i);
            var stdDevBar : Object = {
                "fillAlphas": 1,
				"lineAlpha": 0,
                "title": label,
                "type": "column",
                "openField": "stdlow" + i,
                "closeField": "stdhigh" + i,
                "switchable": false
            };
            var errorBar : Object = {
                "balloonText": "Average +/- standard deviation: [[stdBalloon" + i + "]]\n[[errorBalloon" + i + "]]",
                "bullet": "yError",
                "bulletAxis": "time",
                "bulletSize": 5,
                "errorField": "lowhigherror" + i,
                "type": "column",
                "valueField": "lowhighavg" + i,
                "lineAlpha": 0,
                "visibleInLegend": false,
                "newStack": true
            };
			var guide : Object = {
				"value": avg,
				"balloonText": label,
				"lineThickness": 3
			};
			if (this.props.runSets.length <= xp_common.xamarinColorsOrder.length) {
				var colors = xp_common.xamarinColors [xp_common.xamarinColorsOrder [i]];
				stdDevBar ["fillColors"] = colors [2];
				errorBar ["lineColor"] = colors [2];
				guide ["lineColor"] = colors [2];
			}
            graphs.push (errorBar);
            graphs.push (stdDevBar);
			guides.push (guide);
        }

        var min, max;
        for (i = 0; i < dataArray.length; ++i) {
            var row = dataArray [i];
            var entry = { "benchmark": row [0] };
            for (var j = 0; j < this.props.runSets.length; ++j) {
				var range = rangeInBenchmarkRow (row, j);
                var lowhighavg = (range [0] + range [3]) / 2;
                entry ["stdlow" + j] = range [1];
                entry ["stdhigh" + j] = range [2];
                entry ["lowhighavg" + j] = lowhighavg;
                entry ["lowhigherror" + j] = range [3] - range [0];

                if (min === undefined)
                    min = range [0];
                else
                    min = Math.min (min, range [0]);

                if (max === undefined)
                    max = range [3];
                else
                    max = Math.max (max, range [3]);

                entry ["stdBalloon" + j] = formatPercentage (range [1]) + " - " + formatPercentage (range [2]);
                entry ["errorBalloon" + j] = "Min: " + formatPercentage (range [0]) + " Max: " + formatPercentage (range [3]);
            }
            dataProvider.push (entry);
        }

        this.min = min;
        this.max = max;
        this.graphs = graphs;
		this.guides = guides;
        this.dataProvider = dataProvider;
        this.forceUpdate ();
    }

    render () {
        if (this.dataProvider === undefined)
            return <div className="diagnostic">Loading&hellip;</div>;

        var options = {
            "type": "serial",
            "theme": "default",
            "categoryField": "benchmark",
            "rotate": false,
            "startDuration": 0.3,
            "categoryAxis": {
                "gridPosition": "start"
            },
            "chartScrollbar": {
            },
            "trendLines": [],
            "graphs": this.graphs,
            "dataProvider": this.dataProvider,
            "valueAxes": [
                {
                    "id": "time",
                    "title": "Relative wall clock time",
                    "axisAlpha": 0,
                    "stackType": "regular",
                    "minimum": this.min,
                    "maximum": this.max,
					"guides": this.guides
                }
            ],
            "allLabels": [],
            "balloon": {},
            "titles": [],
            "legend": {
                "useGraphSettings": true
            }
        };

        var zoomFunc;
        if (this.dataProvider.length > 15) {
            zoomFunc = (chart => {
                chart.zoomToCategoryValues (this.dataProvider [0]["benchmark"], this.dataProvider [9]["benchmark"]);
            });
        }

        return <AMChart
            graphName={this.props.graphName}
            height={700}
            options={options}
            initFunc={zoomFunc} />;
    }
}

type TimelineAMChartProps = {
	graphName: string;
	height: number;
	data: Object;
	selectListener: (index: number) => void;
};

export class TimelineAMChart extends React.Component<TimelineAMChartProps, TimelineAMChartProps, void> {
	render () {
		var timelineOptions = {
						"type": "serial",
						"theme": "default",
						"categoryAxis": {
							"axisThickness": 0,
							"gridThickness": 0,
							"labelsEnabled": false,
							"tickLength": 0
						},
						"chartScrollbar": {
							"graph": "average"
						},
						"trendLines": [],
						"graphs": [
							{
								"balloonText": "[[lowName]]",
								"bullet": "round",
								"bulletAlpha": 0,
								"lineColor": xp_common.xamarinColors.blue [2],
								"lineThickness": 0,
								"id": "low",
								"title": "low",
								"valueField": "low"
							},
							{
								"balloonText": "[[highName]]",
								"bullet": "round",
								"bulletAlpha": 0,
								"lineColor": xp_common.xamarinColors.blue [2],
								"fillAlphas": 0.13,
								"fillToGraph": "low",
								"fillColors": xp_common.xamarinColors.blue [2],
								"id": "high",
								"lineThickness": 0,
								"title": "high",
								"valueField": "high"
							},
							{
								"balloonText": "[[tooltip]]",
								"bullet": "round",
								"bulletSize": 4,
								"lineColor": xp_common.xamarinColors.blue [2],
								"lineColorField": "lineColor",
								"id": "geomean",
								"title": "geomean",
								"valueField": "geomean"
							}

						],
						"valueAxes": [
							{
								"baseValue": -13,
								"id": "time",
								"axisThickness": 0,
								"fontSize": 12,
								"gridAlpha": 0.07,
								"title": "",
								"titleFontSize": 0
							}
						],
						"allLabels": [],
						"balloon": {},
						"titles": [],
                        "dataProvider": this.props.data
					};

		return <AMChart
			graphName={this.props.graphName}
			height={this.props.height}
			options={timelineOptions}
			selectListener={this.props.selectListener} />;
	}
}
