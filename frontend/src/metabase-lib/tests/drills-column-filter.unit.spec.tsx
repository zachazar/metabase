import {
  createOrdersTotalDatasetColumn,
  SAMPLE_DB_ID,
} from "metabase-types/api/mocks/presets";
import {
  createQuery,
  findDrillThru,
  queryDrillThru,
} from "metabase-lib/test-helpers";

describe("drill-thru/column-filter", () => {
  const drillType = "drill-thru/column-filter";
  const initialQuery = createQuery();
  const stageIndex = 0;
  const column = createOrdersTotalDatasetColumn();

  describe("availableDrillThrus", () => {
    it("should allow to drill when clicked on a column header", () => {
      const { drillInfo } = findDrillThru(
        drillType,
        initialQuery,
        stageIndex,
        column,
      );

      expect(drillInfo).toMatchObject({
        type: drillType,
      });
    });

    it("should not allow to drill when clicked on a value", () => {
      const value = 10;
      const row = [{ col: column, value }];
      const drill = queryDrillThru(
        drillType,
        initialQuery,
        stageIndex,
        column,
        value,
        row,
      );

      expect(drill).toBeNull();
    });

    it("should not allow to drill when clicked on a null value", () => {
      const value = null;
      const row = [{ col: column, value }];
      const drill = queryDrillThru(
        drillType,
        initialQuery,
        0,
        column,
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

    // eslint-disable-next-line jest/no-disabled-tests
    it.skip("should not allow to drill with a non-editable query", () => {
      const query = createQuery({
        query: {
          type: "query",
          database: 100,
          query: { "source-table": 101 },
        },
      });
      const drill = queryDrillThru(drillType, query, stageIndex, column);
      expect(drill).toBeNull();
    });
  });
});
