import type { DatasetColumn, RowValue } from "metabase-types/api";
import {
  createOrdersTotalDatasetColumn,
  SAMPLE_DB_ID,
} from "metabase-types/api/mocks/presets";
import * as Lib from "metabase-lib";
import {
  columnFinder,
  createQuery,
  findAggregationOperator,
  findDrillThru,
  queryDrillThru,
} from "metabase-lib/test-helpers";
import { createAggregationColumn, createBreakoutColumn } from "./drills-common";

describe("drill-thru/underlying-records", () => {
  const drillType = "drill-thru/underlying-records";
  const defaultQuery = createQueryWithAggregation();
  const stageIndex = 0;
  const aggregationColumn = createAggregationColumn();
  const breakoutColumn = createBreakoutColumn();

  describe("availableDrillThrus", () => {
    it("should allow to drill an aggregated query", () => {
      const { value, row, dimensions } = getAggregatedColumnData(
        aggregationColumn,
        breakoutColumn,
        10,
      );

      const { drillInfo } = findDrillThru(
        drillType,
        defaultQuery,
        stageIndex,
        aggregationColumn,
        value,
        row,
        dimensions,
      );

      expect(drillInfo).toMatchObject({
        type: drillType,
        rowCount: value,
        tableName: "Orders",
      });
    });

    it("should use the default row count for aggregations with negative values", () => {
      const { value, row, dimensions } = getAggregatedColumnData(
        aggregationColumn,
        breakoutColumn,
        -10,
      );

      const { drillInfo } = findDrillThru(
        drillType,
        defaultQuery,
        stageIndex,
        aggregationColumn,
        value,
        row,
        dimensions,
      );

      expect(drillInfo).toMatchObject({
        type: drillType,
        rowCount: 2,
        tableName: "Orders",
      });
    });

    it("should not allow to drill when there is no aggregation", () => {
      const column = createOrdersTotalDatasetColumn();
      const { value, row } = getRawColumnData(column, 10);

      const drill = queryDrillThru(
        drillType,
        defaultQuery,
        stageIndex,
        aggregationColumn,
        value,
        row,
      );

      expect(drill).toBeNull();
    });

    it("should not allow to drill with a native query", () => {
      const query = createQuery({
        query: {
          type: "native",
          database: SAMPLE_DB_ID,
          native: { query: "SELECT * FROM ORDERS" },
        },
      });
      const column = createOrdersTotalDatasetColumn({
        id: undefined,
        field_ref: ["field", "TOTAL", { "base-type": "type/Float" }],
      });

      const drill = queryDrillThru(drillType, query, stageIndex, column);

      expect(drill).toBeNull();
    });
  });

  describe("drillThru", () => {
    it("should drill an aggregated query", () => {
      const { value, row, dimensions } = getAggregatedColumnData(
        aggregationColumn,
        breakoutColumn,
        10,
      );
      const { drill } = findDrillThru(
        drillType,
        defaultQuery,
        stageIndex,
        aggregationColumn,
        value,
        row,
        dimensions,
      );

      const newQuery = Lib.drillThru(defaultQuery, stageIndex, drill);

      expect(Lib.aggregations(newQuery, stageIndex)).toHaveLength(0);
      expect(Lib.filters(newQuery, stageIndex)).toHaveLength(1);
    });
  });
});

function createQueryWithAggregation() {
  const stageIndex = 0;
  const defaultQuery = createQuery();
  const queryWithAggregation = Lib.aggregate(
    defaultQuery,
    stageIndex,
    Lib.aggregationClause(findAggregationOperator(defaultQuery, "count")),
  );
  return Lib.breakout(
    queryWithAggregation,
    stageIndex,
    columnFinder(
      queryWithAggregation,
      Lib.breakoutableColumns(queryWithAggregation, stageIndex),
    )("ORDERS", "CREATED_AT"),
  );
}

function getRawColumnData(column: DatasetColumn, value: RowValue) {
  const row = [{ col: column, value }];
  return { value, row };
}

function getAggregatedColumnData(
  aggregationColumn: DatasetColumn,
  breakoutColumn: DatasetColumn,
  value: RowValue,
) {
  const row = [
    { key: "Created At", col: breakoutColumn, value: "2020-01-01" },
    { key: "Count", col: aggregationColumn, value },
  ];
  const dimensions = [{ column: breakoutColumn, value }];

  return { value, row, dimensions };
}
