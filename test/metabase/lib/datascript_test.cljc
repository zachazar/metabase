(ns metabase.lib.datascript-test
  (:require
   #?@(:clj  ([mb.hawk.assert-exprs.approximately-equal :as =?]
              [methodical.core :as methodical])
       :cljs ([datascript.impl.entity :as d.entity]
              [metabase.test-runner.assert-exprs.approximately-equal :as =?]))
   [clojure.set :as set]
   [clojure.test :refer [deftest is testing]]
   [datascript.core :as d]
   [medley.core :as m]
   [metabase.lib.datascript :as ld]
   [metabase.lib.metadata :as lib.metadata]
   [metabase.lib.test-metadata :as meta]))

;; Adding DataScript's lazily-fetched Entities as a target for `=?`.
(#?@(:clj  (methodical/defmethod =?/=?-diff [clojure.lang.IPersistentMap datascript.impl.entity.Entity])
     :cljs (defmethod            =?/=?-diff [:dispatch-type/map          d.entity/Entity]))
  [exp-map act-entity]
  (first (for [[exp-k exp-v] exp-map
               :let  [act-v (get act-entity exp-k)
                      diff  (if (set? act-v)
                              ;; Sequential - Ignore order, but we want there to exist a mapping from each exp value to
                              ;; some act value.
                              (cond
                                (set?        exp-v) (=?/=?-diff exp-v act-v)
                                (sequential? exp-v) (if (= (count exp-v) (count act-v))
                                                      (=?/=?-diff exp-v act-v)
                                                      ('not= exp-v act-v))
                                :else               (=?/=?-diff exp-v act-v))
                              ;; Scalars - just compare them.
                              (=?/=?-diff exp-v act-v))]
               :when diff]
           {exp-k diff})))

;; We know in this function that every exp has at least one match! This is only to find that there's no possible
;; matching.
(defn- =?-diff-sets-matching [act-set [[exp {:keys [matches]}] & pairs]]
  (let [available (filter act-set matches)]
    (cond
      (empty? available) #{exp}
      (empty? pairs)     nil    ;; Successful match!
      :else (let [tails (for [act available]
                          (=?-diff-sets-matching (disj act-set act) pairs))]
              (if (some nil? tails)
                nil ; Successfully found a matching.
                ;; No matches. Each one returns a set of disappointed exps. Return that union.
                (reduce set/union nil tails))))))

(#?@(:clj  (methodical/defmethod =?/=?-diff [clojure.lang.Sequential   clojure.lang.IPersistentSet])
     :cljs (defmethod            =?/=?-diff [:dispatch-type/sequential :dispatch-type/set]))
  [exps act-set]
  ;; Each exp must be matched with something in the act-set. The order doesn't matter, but there must exist a matching.
  ;; If there are no matching for an exp, we want to show... all the diffs? Just the smallest one?
  (let [;; Results is a parallel list to exps: [exp {:diffs {act diff ...}, :matched true}]
        results (for [exp exps
                      :let [diffs (into {} (map (fn [act]
                                                  [act (=?/=?-diff exp act)]))
                                        act-set)]]
                  [exp {:diffs   (m/filter-vals some? diffs)
                        :matches (set (keys (m/filter-vals nil? diffs)))}])
        unmatched (keep (fn [[_exp {:keys [diffs matches]}]]
                          (when (empty? matches)
                            (set (vals diffs))))
                        results)]
    (if (seq unmatched)
      ;; Returns unmatched with a list of [exp #{diffs...}] pairs.
      ;; TODO: Probably too long?
      (list* 'unmatched unmatched)
      ;; Otherwise try to match everything up consistently.
      (if-let [diff (=?-diff-sets-matching act-set results)]
        (list 'no-matching-among diff)
        nil))))

(def ^:private sample-5-stages
  {:db/id             -10
   :mbql/database     [:metadata.database/id 1]

   :mbql.stage/_query [{:db/id                      -1}
                       {:db/id                      -2
                        :mbql.stage/previous-stage  -1}
                       {:db/id                      -3
                        :mbql.stage/previous-stage  -2}
                       {:db/id                      -4
                        :mbql.stage/previous-stage  -3}
                       {:db/id                      -5
                        :mbql.stage/previous-stage  -4}]
   :mbql.query/stage0 -1
   :mbql.query/stage  -5})

(deftest ^:parallel stage-rules-test
  (let [conn      (ld/fresh-conn)
        tx        (d/transact! conn [sample-5-stages])
        tempids   (:tempids tx)
        query-eid (get tempids -10)
        db        (:db-after tx)
        datalog   '[:find ?stage .
                    :in $ % ?query ?stage-number :where
                    (stage-number ?query ?stage-number ?stage)]]
    (is (= (get tempids -1)
           (d/q datalog db ld/rules-stages query-eid 0)))
    (is (= (get tempids -2)
           (d/q datalog db ld/rules-stages query-eid 1)))
    (is (= (get tempids -3)
           (d/q datalog db ld/rules-stages query-eid 2)))
    (is (= (get tempids -4)
           (d/q datalog db ld/rules-stages query-eid 3)))
    (is (= (get tempids -5)
           (d/q datalog db ld/rules-stages query-eid 4)))
    (is (= (get tempids -5)
           (d/q datalog db ld/rules-stages query-eid -1)))))

(deftest ^:parallel expr-test
  (testing "[= entid literal]"
    (is (=? {:mbql.clause/operator :=
             :mbql.clause/argument [{:mbql/ref    [:metadata.field/id 12]
                                     :mbql/series 0}
                                    {:mbql/lit    7
                                     :mbql/series 1}]}
            (ld/expr := [:metadata.field/id 12] 7))))
  (testing "[= entid Entity]"
    (is (=? {:mbql.clause/operator :=
             :mbql.clause/argument [{:mbql/ref    [:metadata.field/id 12]
                                     :mbql/series 0}
                                    {:mbql/ref    8
                                     :mbql/series 1}]}
            (ld/expr := [:metadata.field/id 12] {:db/id 8, :other/values "here"}))))
  (testing "nesting and multiple arguments"
    (testing "[= entid [= entid 6] 7 8 9]"
      (is (=? {:mbql.clause/operator :=
               :mbql.clause/argument [{:mbql/ref    [:metadata.field/id 12]
                                       :mbql/series 0}
                                      {:mbql/ref    {:mbql.clause/operator :+
                                                     :mbql.clause/argument [{:mbql/ref    [:metadata.field/id 9001]
                                                                             :mbql/series 0}
                                                                            {:mbql/lit    6
                                                                             :mbql/series 1}]}
                                       :mbql/series 1}
                                      {:mbql/lit 7, :mbql/series 2}
                                      {:mbql/lit 8, :mbql/series 3}
                                      {:mbql/lit 9, :mbql/series 4}]}
              (ld/expr := [:metadata.field/id 12]
                       (ld/expr :+ [:metadata.field/id 9001] 6)
                       7 8 9))))))

(deftest ^:parallel query-construction-test
  (testing "basic query"
    (let [query (ld/query meta/metadata-provider (meta/table-metadata :orders))]
      (is (number? (:db/id query)))
      (is (some? (d/entity-db query)))
      (is (d/db? (d/entity-db query)))

      (is (=? {:mbql.query/database {:metadata.database/id (meta/id)}
               :mbql.query/stage0   {:mbql.stage/source {:mbql.source/incoming {:metadata.table/id   (meta/id :orders)
                                                                                :metadata.table/name "ORDERS"}}}}
              query))
      (testing "has only one stage"
        (is (= (:mbql.query/stage0 query)
               (:mbql.query/stage  query))))))

  (testing "filters"
    (testing "one filter"
      (let [query (-> (ld/query meta/metadata-provider (meta/table-metadata :orders))
                      (ld/filter -1 (ld/expr :< [:metadata.field/id (meta/id :orders :subtotal)] 100)))
            exp   {:mbql.clause/operator :<
                   :mbql.clause/argument
                   [{:mbql/ref    {:metadata.field/id (meta/id :orders :subtotal)}
                     :mbql/series 0}
                    {:mbql/lit    100
                     :mbql/series 1}]
                   :mbql/series 0}]
        (is (=? {:mbql.query/stage {:mbql.stage/filter [exp]}}
                query))
        (is (=? [exp]
                (ld/filters query -1))))
      (testing "nested expressions"
        (let [query (-> (ld/query meta/metadata-provider (meta/table-metadata :orders))
                        (ld/filter -1 (ld/expr :>
                                               (ld/expr (keyword "/")
                                                        [:metadata.field/id (meta/id :orders :discount)]
                                                        [:metadata.field/id (meta/id :orders :subtotal)])
                                               0.1)))
              exp   {:mbql.clause/operator :>
                     :mbql.clause/argument
                     [{:mbql/ref    {:mbql.clause/operator (keyword "/")
                                     :mbql.clause/argument
                                     ;; Showing that the order here doesn't matter.
                                     [{:mbql/ref {:metadata.field/id (meta/id :orders :subtotal)}
                                       :mbql/series 1}
                                      {:mbql/ref {:metadata.field/id (meta/id :orders :discount)}
                                       :mbql/series 0}]}
                       :mbql/series 0}
                      {:mbql/lit    0.1
                       :mbql/series 1}]
                     :mbql/series 0}]
          (is (=? {:mbql.query/stage {:mbql.stage/filter [exp]}}
                  query))
          (is (=? [exp]
                  (ld/filters query -1))))))
    (testing "multiple filters"
      (let [query            (-> (ld/query meta/metadata-provider (meta/table-metadata :orders))
                                 (ld/filter -1 (ld/expr :> [:metadata.field/id (meta/id :orders :subtotal)] 100))
                                 (ld/filter -1 (ld/expr := [:metadata.field/id (meta/id :products :category)] "Doohickey"))
                                 (ld/filter -1 (ld/expr :< [:metadata.field/id (meta/id :orders :tax)] 20)))
            filter-subtotal  {:mbql.clause/operator :>
                              :mbql.clause/argument
                              [{:mbql/series 0, :mbql/ref {:metadata.field/id (meta/id :orders :subtotal)}}
                               {:mbql/series 1, :mbql/lit 100}]
                              :mbql/series 0}
            filter-category  {:mbql.clause/operator :=
                              :mbql.clause/argument
                              [{:mbql/series 0, :mbql/ref {:metadata.field/id (meta/id :products :category)}}
                               {:mbql/series 1, :mbql/lit "Doohickey"}]
                              :mbql/series 1}
            filter-tax       {:mbql.clause/operator :<
                              :mbql.clause/argument
                              [{:mbql/series 0, :mbql/ref {:metadata.field/id (meta/id :orders :tax)}}
                               {:mbql/series 1, :mbql/lit 20}]
                              :mbql/series 2}
            filters          [filter-subtotal filter-category filter-tax]]
        (testing "undefined order with direct DB access - =? hides the details"
          (doseq [shuffled (take 5 (iterate shuffle filters))]
            (is (=? {:mbql.query/stage {:mbql.stage/filter shuffled}}
                    query))))
        (testing "ld/filters does sort the output"
          (is (=? filters (ld/filters query -1))))))))

(deftest ^:parallel aggregations-test
  (testing "aggregations"
    (testing "individually"
      (let [query (-> (ld/query meta/metadata-provider (meta/table-metadata :orders))
                      (ld/aggregate -1 (ld/agg-count)))
            exp   {:mbql.aggregation/operator :count
                   :mbql/series               0}]
        (is (=? {:mbql.query/stage {:mbql.stage/aggregation [exp]}}
                query))
        (is (=? [exp]
                (ld/aggregations query -1)))))
    (testing "multiple aggregations"
      (let [query            (-> (ld/query meta/metadata-provider (meta/table-metadata :orders))
                                 (ld/aggregate -1 (ld/agg-count))
                                 (ld/aggregate -1 (ld/agg-sum [:metadata.field/id (meta/id :orders :subtotal)]))
                                 (ld/aggregate -1 (ld/agg-sum-where
                                                    [:metadata.field/id (meta/id :orders :discount)]
                                                    (ld/expr :not-null [:metadata.field/id (meta/id :orders :discount)])))
                                 (ld/aggregate -1 (ld/agg-count-where
                                                    (ld/expr :> [:metadata.field/id (meta/id :products :category)]
                                                             "Doohickey"))))
            agg-count        {:mbql.aggregation/operator :count
                              :mbql/series               0}
            agg-sum          {:mbql.aggregation/operator :sum
                              :mbql.aggregation/column   {:metadata.field/id  (meta/id :orders :subtotal)}
                              :mbql/series               1}
            agg-sum-where    {:mbql.aggregation/operator :sum-where
                              :mbql.aggregation/column   {:metadata.field/id  (meta/id :orders :discount)}
                              :mbql/series               2
                              :mbql.aggregation/filter
                              {:mbql.clause/operator :not-null
                               :mbql.clause/argument [{:mbql/ref    {:metadata.field/id (meta/id :orders :discount)}
                                                       :mbql/series 0}]}}
            agg-count-where  {:mbql.aggregation/operator :count-where
                              :mbql/series               3
                              :mbql.aggregation/filter
                              {:mbql.clause/operator :>
                               :mbql.clause/argument [{:mbql/ref    {:metadata.field/id (meta/id :products :category)}
                                                       :mbql/series 0}
                                                      {:mbql/lit    "Doohickey"
                                                       :mbql/series 1}]}}
            aggs             [agg-count agg-sum agg-sum-where agg-count-where]]
        (testing "undefined order with direct DB access - =? hides the details"
          (doseq [shuffled (take 5 (iterate shuffle aggs))]
            (is (=? {:mbql.query/stage {:mbql.stage/aggregation shuffled}}
                    query))))
        (testing "ld/aggregations does sort the output"
          (is (=? aggs (ld/aggregations query -1))))))))

(deftest ^:parallel expressions-test
  (testing "expressions"
    (testing "individually"
      (let [query (-> (ld/query meta/metadata-provider (meta/table-metadata :orders))
                      (ld/expression -1 "taxes_25p" (ld/expr :* [:metadata.field/id (meta/id :orders :subtotal)]
                                                             0.25)))
            exp   {:mbql.expression/name "taxes_25p"
                   :mbql.clause/operator :*
                   :mbql.clause/argument [{:mbql/ref    {:metadata.field/id (meta/id :orders :subtotal)}
                                           :mbql/series 0}
                                          {:mbql/lit    0.25
                                           :mbql/series 1}]
                   :mbql/series          0}]
        (is (=? {:mbql.query/stage {:mbql.stage/expression [exp]}}
                query))
        (is (=? [exp]
                (ld/expressions query -1)))))
    (testing "multiple expressions"
      (let [query            (-> (ld/query meta/metadata-provider (meta/table-metadata :orders))
                                 (ld/expression -1 "taxes_25p"
                                                (ld/expr :* [:metadata.field/id (meta/id :orders :subtotal)] 0.25))
                                 (ld/expression -1 "tax_rate"
                                                (ld/expr (keyword "/")
                                                         [:metadata.field/id (meta/id :orders :tax)]
                                                         [:metadata.field/id (meta/id :orders :subtotal)]))
                                 (ld/expression -1 "discount_ratio"
                                                (ld/expr (keyword "/")
                                                         (ld/expr :coalesce
                                                                  [:metadata.field/id (meta/id :orders :discount)]
                                                                  0)
                                                         [:metadata.field/id (meta/id :orders :subtotal)])))
            exp-taxes-25p    {:mbql.expression/name "taxes_25p"
                              :mbql/series          0
                              :mbql.clause/operator :*
                              :mbql.clause/argument
                              [{:mbql/series 0, :mbql/ref {:metadata.field/id (meta/id :orders :subtotal)}}
                               {:mbql/series 1, :mbql/lit 0.25}]}
            exp-tax-rate     {:mbql.expression/name "tax_rate"
                              :mbql/series          1
                              :mbql.clause/operator (keyword "/")
                              :mbql.clause/argument
                              [{:mbql/series 0, :mbql/ref {:metadata.field/id (meta/id :orders :tax)}}
                               {:mbql/series 1, :mbql/ref {:metadata.field/id (meta/id :orders :subtotal)}}]}
            exp-discount     {:mbql.expression/name "discount_ratio"
                              :mbql/series          2
                              :mbql.clause/operator (keyword "/")
                              :mbql.clause/argument
                              [{:mbql/series          0
                                :mbql/ref {:mbql.clause/operator :coalesce
                                           :mbql.clause/argument
                                           [{:mbql/series 0
                                             :mbql/ref    {:metadata.field/id (meta/id :orders :discount)}}
                                            {:mbql/series 1
                                             :mbql/lit    0}]}}
                               {:mbql/series 1, :mbql/ref {:metadata.field/id (meta/id :orders :subtotal)}}]}
            exprs            [exp-taxes-25p exp-tax-rate exp-discount]]
        (testing "undefined order with direct DB access - =? hides the details"
          (doseq [shuffled (take 5 (iterate shuffle exprs))]
            (is (=? {:mbql.query/stage {:mbql.stage/expression shuffled}}
                    query))))
        (testing "ld/expressions does sort the output"
          (is (=? exprs (ld/expressions query -1))))))))

(deftest ^:parallel breakouts-test
  (testing "breakouts"
    (testing "individually"
      (let [query (-> (ld/query meta/metadata-provider (meta/table-metadata :orders))
                      (ld/aggregate -1 (ld/agg-count))
                      ;; TODO: This is an implicit join! I shouldn't be able to add this directly, since there might
                      ;; be multiple FKs pointing at the same table.
                      (ld/breakout -1 [:metadata.field/id (meta/id :products :category)]))
            brk   {:mbql.breakout/origin {:metadata.field/id (meta/id :products :category)}
                   :mbql/series          0}]
        (is (=? {:mbql.query/stage {:mbql.stage/breakout [brk]}}
                query))
        (is (=? [brk]
                (ld/breakouts query -1)))))
    (testing "multiple breakouts"
      (let [query        (-> (ld/query meta/metadata-provider (meta/table-metadata :orders))
                             (ld/aggregate -1 (ld/agg-count))
                             ;; TODO: This is an implicit join as well!
                             (ld/breakout -1 [:metadata.field/id (meta/id :products :category)])
                             (ld/breakout -1 (ld/with-temporal-bucketing
                                               [:metadata.field/id (meta/id :orders :created-at)]
                                               :month)))
            brk-category {:mbql.breakout/origin        {:metadata.field/id (meta/id :products :category)}
                          :mbql/series                 0}
            brk-month    {:mbql.breakout/origin        {:metadata.field/id (meta/id :orders :created-at)}
                          :mbql.breakout/temporal-unit :month
                          :mbql/series                 1}
            brks         [brk-category brk-month]]
        (testing "undefined order with direct DB access - =? hides the details"
          (doseq [shuffled (take 5 (iterate shuffle brks))]
            (is (=? {:mbql.query/stage {:mbql.stage/breakout shuffled}}
                    query))))
        (testing "ld/breakouts does sort the output"
          (is (=? brks (ld/breakouts query -1))))))))

(defn- expected-fields [table-key]
  (->> (for [field-key (meta/fields table-key)
             :let [field (meta/field-metadata table-key field-key)]]
         {:metadata.field/id       (:id field)
          :metadata.field/name     (:name field)
          :metadata.field/table    {:metadata.table/id (:table-id field)}
          :metadata.field/position (:position field)})
       (sort-by :metadata.field/position)))

(deftest ^:parallel returned-columns-test
  (testing "just tables"
    (doseq [table (meta/tables)]
      (is (=? (expected-fields table)
              (-> (ld/query meta/metadata-provider (meta/table-metadata table))
                  (ld/returned-columns -1))))))
  (testing "with expressions"
    (let [expr-query (-> (ld/query meta/metadata-provider (meta/table-metadata :orders))
                         (ld/expression -1 "tax_rate"
                                        (ld/expr (keyword "/")
                                                 [:metadata.field/id (meta/id :orders :tax)]
                                                 [:metadata.field/id (meta/id :orders :subtotal)]))
                         (ld/expression -1 "discount_ratio"
                                        (ld/expr (keyword "/")
                                                 (ld/expr :coalesce
                                                          [:metadata.field/id (meta/id :orders :discount)]
                                                          0)
                                                 [:metadata.field/id (meta/id :orders :subtotal)])))]
      (is (=? (concat (expected-fields :orders)
                      [{:mbql.expression/name "tax_rate"}
                       {:mbql.expression/name "discount_ratio"}])
              (ld/returned-columns expr-query -1)))
      (testing "and breakouts"
        (is (=? (concat (expected-fields :orders)
                        [{:mbql.expression/name        "tax_rate"}
                         {:mbql.expression/name        "discount_ratio"}
                         {:mbql.breakout/origin        {:metadata.field/id (meta/id :orders :created-at)}
                          :mbql.breakout/temporal-unit :month}])
                (-> (ld/breakout expr-query -1 (ld/with-temporal-bucketing
                                                 [:metadata.field/id (meta/id :orders :created-at)]
                                                 :month))
                    (ld/returned-columns -1)))))))
  (testing "with aggregations"
    (let [agg-query (-> (ld/query meta/metadata-provider (meta/table-metadata :orders))
                        (ld/aggregate -1 (ld/agg-count))
                        (ld/aggregate -1 (ld/agg-sum [:metadata.field/id (meta/id :orders :subtotal)]))
                        (ld/aggregate -1 (ld/agg-sum-where
                                           [:metadata.field/id (meta/id :orders :discount)]
                                           (ld/expr :not-null [:metadata.field/id (meta/id :orders :discount)]))))]
      (is (=? [{:mbql.aggregation/operator :count}
               {:mbql.aggregation/operator :sum}
               {:mbql.aggregation/operator :sum-where}]
              (ld/returned-columns agg-query -1)))
      (testing "and breakouts"
        ;; Breakouts come before aggregations
        (is (=? [{:mbql.breakout/origin        {:metadata.field/id (meta/id :orders :created-at)}
                  :mbql.breakout/temporal-unit :month}
                 {:mbql.aggregation/operator :count}
                 {:mbql.aggregation/operator :sum}
                 {:mbql.aggregation/operator :sum-where}]
                (-> agg-query
                    (ld/breakout -1 (ld/with-temporal-bucketing
                                      [:metadata.field/id (meta/id :orders :created-at)]
                                      :month))
                    (ld/returned-columns -1))))))))

(defn- field->implicit-join-group [field]
  (when-let [target-id (:fk-target-field-id field)]
    (let [foreign-pk    (lib.metadata/field meta/metadata-provider target-id)
          foreign-table (lib.metadata/table meta/metadata-provider (:table-id foreign-pk))]
      {:lib/type                              :metadata/column-group
       :metabase.lib.column-group/group-type  :group-type/join.implicit
       :metabase.lib.column-group/foreign-key {:metadata.field/id (:id field)}
       :metabase.lib.column-group/columns
       (->> (for [field (lib.metadata/fields meta/metadata-provider (:id foreign-table))]
              {:metadata.field/id       (:id field)
               :metadata.field/name     (:name field)
               :metadata.field/table    {:metadata.table/id (:table-id field)}
               :metadata.field/position (:position field)})
            (sort-by :metadata.field/position))})))

(deftest ^:parallel visible-column-groups-test
  (testing "just tables"
    (doseq [table (meta/tables)]
      (is (=? (->> (meta/fields table)
                   (map #(meta/field-metadata table %))
                   (sort-by :position)
                   (keep field->implicit-join-group)
                   (into [{:lib/type                             :metadata/column-group
                           :metabase.lib.column-group/group-type :group-type/main
                           :metabase.lib.column-group/columns    (expected-fields table)}]))
              (-> (ld/query meta/metadata-provider (meta/table-metadata table))
                  (ld/visible-column-groups -1))))))
  (testing "with expressions"
    (let [expr-query (-> (ld/query meta/metadata-provider (meta/table-metadata :orders))
                         (ld/expression -1 "tax_rate"
                                        (ld/expr (keyword "/")
                                                 [:metadata.field/id (meta/id :orders :tax)]
                                                 [:metadata.field/id (meta/id :orders :subtotal)]))
                         (ld/expression -1 "discount_ratio"
                                        (ld/expr (keyword "/")
                                                 (ld/expr :coalesce
                                                          [:metadata.field/id (meta/id :orders :discount)]
                                                          0)
                                                 [:metadata.field/id (meta/id :orders :subtotal)])))]
      (is (=? [{:lib/type                             :metadata/column-group
                :metabase.lib.column-group/group-type :group-type/main
                :metabase.lib.column-group/columns
                (concat (expected-fields :orders)
                        [{:mbql.expression/name "tax_rate"}
                         {:mbql.expression/name "discount_ratio"}])}
               (field->implicit-join-group (meta/field-metadata :orders :user-id))
               (field->implicit-join-group (meta/field-metadata :orders :product-id))]
              (ld/visible-column-groups expr-query -1)))
      (testing "and breakouts - does not include the breakouts"
        (is (=? [{:lib/type                             :metadata/column-group
                  :metabase.lib.column-group/group-type :group-type/main
                  :metabase.lib.column-group/columns
                  (concat (expected-fields :orders)
                        [{:mbql.expression/name        "tax_rate"}
                         {:mbql.expression/name        "discount_ratio"}])}
                 (field->implicit-join-group (meta/field-metadata :orders :user-id))
                 (field->implicit-join-group (meta/field-metadata :orders :product-id))]
                (-> (ld/breakout expr-query -1 (ld/with-temporal-bucketing
                                                 [:metadata.field/id (meta/id :orders :created-at)]
                                                 :month))
                    (ld/visible-column-groups -1)))))))
  (testing "ignores aggregations"
    (let [agg-query (-> (ld/query meta/metadata-provider (meta/table-metadata :orders))
                        (ld/aggregate -1 (ld/agg-count))
                        (ld/aggregate -1 (ld/agg-sum [:metadata.field/id (meta/id :orders :subtotal)]))
                        (ld/aggregate -1 (ld/agg-sum-where
                                           [:metadata.field/id (meta/id :orders :discount)]
                                           (ld/expr :not-null [:metadata.field/id (meta/id :orders :discount)]))))]
      (is (=? [{:lib/type                             :metadata/column-group
                :metabase.lib.column-group/group-type :group-type/main
                :metabase.lib.column-group/columns
                (expected-fields :orders)}
               (field->implicit-join-group (meta/field-metadata :orders :user-id))
               (field->implicit-join-group (meta/field-metadata :orders :product-id))]
              (ld/visible-column-groups agg-query -1)))
      (testing "and breakouts"
        (is (=? [{:lib/type                             :metadata/column-group
                  :metabase.lib.column-group/group-type :group-type/main
                  :metabase.lib.column-group/columns
                  (expected-fields :orders)}
                 (field->implicit-join-group (meta/field-metadata :orders :user-id))
                 (field->implicit-join-group (meta/field-metadata :orders :product-id))]
                (-> agg-query
                    (ld/breakout -1 (ld/with-temporal-bucketing
                                      [:metadata.field/id (meta/id :orders :created-at)]
                                      :month))
                    (ld/visible-column-groups -1))))))))
