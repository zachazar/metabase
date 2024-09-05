(ns metabase.models.notification
  (:require
   [clojure.string :as str]
   [metabase.models.interface :as mi]
   [metabase.util :as u]
   [methodical.core :as methodical]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(methodical/defmethod t2/table-name :model/Notification             [_model] :notification)
(methodical/defmethod t2/table-name :model/NotificationSubscription [_model] :notification_subscription)

(defn- assert-enum
  [enum value]
  (assert (set? enum) "enum but be a set")
  (when-not (contains? enum value)
    (throw (ex-info (format "Invalid value %s. Must be one of %s" value (str/join ", " enum)) {:status-code 400}))))

(def ^:private notification-types #{:notification/system-event})
(def ^:private subscription-types #{:notification-subscription/event})
(def ^:private subscription-event-name-types (descendants :metabase/event))

(t2/deftransforms :model/Notification
  {:payload_type (mi/transform-validator mi/transform-keyword (partial assert-enum notification-types))})

(t2/deftransforms :model/NotificationSubscription
  {:type       (mi/transform-validator mi/transform-keyword (partial assert-enum subscription-types))
   :event_name (mi/transform-validator mi/transform-keyword (partial assert-enum subscription-event-name-types))})

(doseq [model [:model/Notification
               :model/NotificationSubscription]]
  (doto model
    (derive :metabase/model)
    (derive (if (= model :model/NotificationSubscription)
              :hook/created-at-timestamped?
              :hook/timestamped?))))

(defn notifications-for-event
  "Find all notifications for a given event."
  [event-name]
  (t2/select :model/Notification
             {:select    [:n.*]
              :from      [[:notification :n]]
              :left-join [[:notification_subscription :ns] [:= :n.id :ns.notification_id]]
              :where     [:and [:= :ns.event_name (u/qualified-name event-name)]
                          [:= :ns.type (u/qualified-name :notification-subscription/event)]]}))
