/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * @global
 * @typedef {import("moment")} moment
 */

/**
 * @param {*} deliveryService
 * @param {*} $scope
 * @param {import("angular").ITimeoutService} $timeout
 * @param {import("angular").IFilterService} $filter
 * @param {import("angular").IQService} $q
 * @param {import("angular").IIntervalService} $interval
 * @param {import("../../../api/DeliveryServiceStatsService")} deliveryServiceStatsService
 * @param {import("../../../service/utils/DateUtils")} dateUtils
 * @param {import("../../../service/utils/NumberUtils")} numberUtils
 * @param {import("../../../models/PropertiesModel")} propertiesModel
 */
var ChartBPSController = function(deliveryService, $scope, $timeout, $filter, $q, $interval, deliveryServiceStatsService, dateUtils, numberUtils, propertiesModel) {

	var chartSeries,
		chartOptions;

	var chartInterval,
		autoRefresh = propertiesModel.properties.deliveryServices.charts.autoRefresh;

	var chartData = [];

	var refreshBPS = function() {
		registerResizeListener();
		getChartData($scope.deliveryService.xmlId, moment().subtract(1, 'days'), moment().subtract(10, 'seconds'));
	};

	var getChartData = function(xmlId, start, end) {
		var promises = [];

		// get ds bps
		promises.push(deliveryServiceStatsService.getBPS(xmlId, start, end));

		$q.all(promises)
			.then(
				function(responses) {
					// set date range text
					$scope.dateRangeText = dateUtils.dateFormat(start.toDate(), "UTC: ddd mmm d yyyy H:MM:ss tt (Z)") + ' to ' + dateUtils.dateFormat(end.toDate(), "UTC: ddd mmm d yyyy H:MM:ss tt (Z)");
					// set chart data
					chartData = (responses[0].series) ? buildBandwidthChartData(responses[0].series, start) : chartData;
					// set summary data
					$scope.summaryData = responses[0].summary;

					$timeout(function () {
						buildChart(chartData);
					}, 100);
				},
				function(fault) {
					buildChart([]); // build an empty chart
				});

	};

	var buildBandwidthChartData = function(series, start) {
		var normalizedChartData = [];

		if (angular.isDefined(series)) {
			series.values.forEach(function(seriesItem) {
				if (moment(seriesItem[0]).isSame(start) || moment(seriesItem[0]).isAfter(start)) {
					normalizedChartData.push([ moment(seriesItem[0]).valueOf(),
						numberUtils.convertTo(seriesItem[1], $scope.unitSize) ]); // converts data to appropriate unit
				}
			});
		}

		return normalizedChartData;
	};

	var buildChart = function(bandwidthChartData) {

		chartOptions = {
			xaxis: {
				mode: "time",
				timezone: "utc",
				twelveHourClock: false,
				timeBase: "milliseconds"
			},
			yaxes: [
				{
					position: "left",
					axisLabel: "Bandwidth (Gbps)",
					axisLabelUseCanvas: true,
					axisLabelFontSizePixels: 12,
					axisLabelFontFamily: 'Verdana, Arial',
					axisLabelPadding: 3
				}
			],
			legend: {
				position: "nw"
			},
			grid: {
				hoverable: true,
				axisMargin: 20
			},
			tooltip: {
				show: true,
				content: function(label, xval, yval, flotItem){
					var tooltipString = dateUtils.dateFormat(xval, "UTC: ddd mmm d yyyy H:MM:ss tt (Z)") + '<br>';
					tooltipString += '<span>' + label + ': ' + $filter('number')(yval, 2) + '</span><br>'
					return tooltipString;
				}
			}
		};

		chartSeries = [
			{ label: "Bandwidth", yaxis: 1, color: '#3498DB', data: bandwidthChartData }
		];

		plotChart();

	};

	var createIntervals = function() {
		killIntervals();
		chartInterval = $interval(function() { refreshBPS() }, propertiesModel.properties.deliveryServices.charts.refreshRateInMS );
	};

	var killIntervals = function() {
		if (angular.isDefined(chartInterval)) {
			$interval.cancel(chartInterval);
			chartInterval = undefined;
		}
	};

	var registerResizeListener = function() {
		$(window).bind("resize", plotChart);
	};

	var unregisterResizeListener = function() {
		$(window).unbind("resize", plotChart);
	};

	var plotChart = function() {
		if (chartOptions && chartSeries) {
			$.plot($("#ds-bps-chart-" + $scope.deliveryService.id), chartSeries, chartOptions);
		}
	};

	$scope.deliveryService = deliveryService;

	$scope.summaryData = {};

	$scope.dateRangeText;

	$scope.unitSize = 'Gb';

	$scope.$on("$destroy", function() {
		killIntervals();
		unregisterResizeListener();
	});

	angular.element(document).ready(function () {
		refreshBPS();
		if (autoRefresh) {
			createIntervals();
		}
	});

};

ChartBPSController.$inject = ['deliveryService', '$scope', '$timeout', '$filter', '$q', '$interval', 'deliveryServiceStatsService', 'dateUtils', 'numberUtils', 'propertiesModel'];
module.exports = ChartBPSController;
