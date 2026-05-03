package main

import (
	"sort"
	"time"
)

// ---------- trip detection ----------

type Trip struct {
	StartTS         int64   `json:"start_ts"`
	EndTS           int64   `json:"end_ts"`
	DurationMin     float64 `json:"duration_min"`
	DistanceNm      float64 `json:"distance_nm"`
	MaxSog          float64 `json:"max_sog"`
	AvgSog          float64 `json:"avg_sog"`
	MaxDistMarinaNm float64 `json:"max_dist_from_marina_nm"`
	Points          int     `json:"points"`
}

// DetectTrips infers trips from a chronological track.
//   - "Away" once vessel is > leaveDistM and SOG > minSog
//   - "Home" when within backDistM and SOG < minSog
//   - Forces a flush after gapBreakSec of no points
func DetectTrips(pts []TrackPoint, marinaLat, marinaLon float64) []Trip {
	const (
		leaveDistM  = 800.0
		backDistM   = 400.0
		minSog      = 0.5
		gapBreakSec = int64(6 * 3600)
	)
	var trips []Trip
	var cur *Trip
	var sumDist, sumSog float64
	var lastPt *TrackPoint
	inTrip := false

	flush := func(end int64) {
		if cur == nil {
			return
		}
		cur.EndTS = end
		cur.DurationMin = float64(end-cur.StartTS) / 60000.0
		cur.DistanceNm = sumDist / 1852.0
		if cur.Points > 0 {
			cur.AvgSog = sumSog / float64(cur.Points)
		}
		trips = append(trips, *cur)
		cur = nil
		sumDist = 0
		sumSog = 0
	}

	for i := range pts {
		p := pts[i]
		dM := haversineMeters(p.Lat, p.Lon, marinaLat, marinaLon)
		if !inTrip {
			if dM > leaveDistM && p.Sog >= minSog {
				inTrip = true
				cur = &Trip{StartTS: p.TS, MaxSog: p.Sog, Points: 1}
				sumSog = p.Sog
				cur.MaxDistMarinaNm = dM / 1852.0
				lastPt = &p
			}
			continue
		}
		if lastPt != nil {
			gap := (p.TS - lastPt.TS) / 1000
			if gap > gapBreakSec {
				flush(lastPt.TS)
				inTrip = false
				lastPt = nil
				// re-evaluate this point as potential new trip start
				if dM > leaveDistM && p.Sog >= minSog {
					inTrip = true
					cur = &Trip{StartTS: p.TS, MaxSog: p.Sog, Points: 1, MaxDistMarinaNm: dM / 1852.0}
					sumSog = p.Sog
					lastPt = &p
				}
				continue
			}
			sumDist += haversineMeters(lastPt.Lat, lastPt.Lon, p.Lat, p.Lon)
		}
		sumSog += p.Sog
		cur.Points++
		if p.Sog > cur.MaxSog {
			cur.MaxSog = p.Sog
		}
		if dnm := dM / 1852.0; dnm > cur.MaxDistMarinaNm {
			cur.MaxDistMarinaNm = dnm
		}
		lastPt = &p

		if dM < backDistM && p.Sog < minSog {
			flush(p.TS)
			inTrip = false
			lastPt = nil
		}
	}
	if inTrip && lastPt != nil {
		flush(lastPt.TS)
	}
	return trips
}

// ---------- daily summary ----------

type DaySummary struct {
	Date        string  `json:"date"` // YYYY-MM-DD UTC
	DistanceNm  float64 `json:"distance_nm"`
	MaxSog      float64 `json:"max_sog"`
	UnderwayMin float64 `json:"underway_min"`
	AtMarinaMin float64 `json:"at_marina_min"`
	Points      int     `json:"points"`
}

// DailySummaries aggregates a chronological track into per-day stats (UTC).
//   - Distance = sum of inter-point haversine on same UTC day, gap < 30 min.
//   - Underway = inter-point minutes where avg SOG >= 0.5 kn.
//   - AtMarina = inter-point minutes where current point is within 500 m of marina.
func DailySummaries(pts []TrackPoint, marinaLat, marinaLon float64) []DaySummary {
	const (
		maxGapMin    = 30.0
		minSog       = 0.5
		atMarinaDist = 500.0
	)
	days := map[string]*DaySummary{}
	var prev *TrackPoint
	for i := range pts {
		p := pts[i]
		date := time.UnixMilli(p.TS).UTC().Format("2006-01-02")
		d := days[date]
		if d == nil {
			d = &DaySummary{Date: date}
			days[date] = d
		}
		d.Points++
		if p.Sog > d.MaxSog {
			d.MaxSog = p.Sog
		}
		if prev != nil {
			prevDate := time.UnixMilli(prev.TS).UTC().Format("2006-01-02")
			if prevDate == date {
				dt := float64(p.TS-prev.TS) / 60000.0
				if dt > 0 && dt < maxGapMin {
					dist := haversineMeters(prev.Lat, prev.Lon, p.Lat, p.Lon)
					d.DistanceNm += dist / 1852.0
					if (prev.Sog+p.Sog)/2 >= minSog {
						d.UnderwayMin += dt
					}
					if haversineMeters(p.Lat, p.Lon, marinaLat, marinaLon) < atMarinaDist {
						d.AtMarinaMin += dt
					}
				}
			}
		}
		prev = &p
	}
	out := make([]DaySummary, 0, len(days))
	for _, d := range days {
		out = append(out, *d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Date < out[j].Date })
	return out
}
