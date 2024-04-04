import {
  getXAxisModel,
  getYAxesModels,
} from "metabase/visualizations/echarts/cartesian/model/axis";
import {
  getBubbleSizeDomain,
  getCardsColumnByDataKeyMap,
  getJoinedCardsDataset,
  getSortedSeriesModels,
  applyVisualizationSettingsDataTransformations,
  sortDataset,
} from "metabase/visualizations/echarts/cartesian/model/dataset";
import {
  getCardSeriesModels,
  getDimensionModel,
} from "metabase/visualizations/echarts/cartesian/model/series";
import type {
  CartesianChartModel,
  ShowWarning,
} from "metabase/visualizations/echarts/cartesian/model/types";
import { getScatterPlotDataset } from "metabase/visualizations/echarts/cartesian/scatter/model";
import type { CartesianChartColumns } from "metabase/visualizations/lib/graph/columns";
import { getCartesianChartColumns } from "metabase/visualizations/lib/graph/columns";
import type {
  ComputedVisualizationSettings,
  RenderingContext,
} from "metabase/visualizations/types";
import type { RawSeries } from "metabase-types/api";

import { getAxisTransforms } from "./transforms";
import { getTrendLineModelAndDatasets } from "./trend-line";

const SUPPORTED_AUTO_SPLIT_TYPES = ["line", "area", "bar", "combo"];

export const getCardsColumns = (
  rawSeries: RawSeries,
  settings: ComputedVisualizationSettings,
) => {
  return rawSeries.map(({ data, card }) => {
    // When multiple cards are combined on a dashboard card, computed visualization settings contain
    // dimensions and metrics settings of the first card only which is not correct.
    // Using the raw visualization settings for that is safe because we can combine
    // only saved cards that have these settings.
    const shouldUseIndividualCardSettings = rawSeries.length > 1;
    const cardSettings = shouldUseIndividualCardSettings
      ? card.visualization_settings
      : settings;

    return getCartesianChartColumns(data.cols, cardSettings);
  });
};

export const getCardsSeriesModels = (
  rawSeries: RawSeries,
  cardsColumns: CartesianChartColumns[],
  settings: ComputedVisualizationSettings,
  renderingContext: RenderingContext,
) => {
  const hasMultipleCards = rawSeries.length > 1;
  return rawSeries.flatMap((cardDataset, index) => {
    const cardColumns = cardsColumns[index];

    return getCardSeriesModels(
      cardDataset,
      cardColumns,
      hasMultipleCards,
      index === 0,
      settings,
      renderingContext,
    );
  });
};

export const getCartesianChartModel = (
  rawSeries: RawSeries,
  settings: ComputedVisualizationSettings,
  renderingContext: RenderingContext,
  showWarning?: ShowWarning,
): CartesianChartModel => {
  // rawSeries has more than one element when two or more cards are combined on a dashboard
  const hasMultipleCards = rawSeries.length > 1;
  const cardsColumns = getCardsColumns(rawSeries, settings);
  const columnByDataKey = getCardsColumnByDataKeyMap(rawSeries, cardsColumns);
  const dimensionModel = getDimensionModel(rawSeries, cardsColumns);
  const unsortedSeriesModels = getCardsSeriesModels(
    rawSeries,
    cardsColumns,
    settings,
    renderingContext,
  );

  // We currently ignore sorting and visibility settings on combined cards
  const seriesModels = hasMultipleCards
    ? unsortedSeriesModels
    : getSortedSeriesModels(unsortedSeriesModels, settings);

  let dataset;
  switch (rawSeries[0].card.display) {
    case "scatter":
      dataset = getScatterPlotDataset(rawSeries, cardsColumns);
      break;
    default:
      dataset = getJoinedCardsDataset(rawSeries, cardsColumns, showWarning);
  }
  dataset = sortDataset(dataset, settings["graph.x_axis.scale"], showWarning);

  const xAxisModel = getXAxisModel(
    dimensionModel,
    rawSeries,
    dataset,
    settings,
    renderingContext,
  );
  const yAxisScaleTransforms = getAxisTransforms(
    settings["graph.y_axis.scale"],
    settings["stackable.stack_type"],
  );

  const transformedDataset = applyVisualizationSettingsDataTransformations(
    dataset,
    xAxisModel,
    seriesModels,
    yAxisScaleTransforms,
    settings,
    showWarning,
  );

  const isAutoSplitSupported = SUPPORTED_AUTO_SPLIT_TYPES.includes(
    rawSeries[0].card.display,
  );

  const insights = rawSeries.flatMap(series => series.data.insights ?? []);

  const { leftAxisModel, rightAxisModel } = getYAxesModels(
    seriesModels,
    transformedDataset,
    settings,
    columnByDataKey,
    isAutoSplitSupported,
    renderingContext,
  );

  const { trendLinesSeries, trendLinesDataset } = getTrendLineModelAndDatasets(
    seriesModels,
    dataset,
    yAxisScaleTransforms,
    insights,
    settings,
    renderingContext,
  );

  return {
    dataset,
    transformedDataset,
    seriesModels,
    yAxisScaleTransforms,
    columnByDataKey,
    dimensionModel,
    insights,
    xAxisModel,
    leftAxisModel,
    rightAxisModel,
    trendLinesDataset,
    trendLinesSeries,
    bubbleSizeDomain: getBubbleSizeDomain(seriesModels, transformedDataset),
  };
};