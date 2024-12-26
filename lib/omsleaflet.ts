/** @preserve OverlappingMarkerSpiderfier
 * https://github.com/jawj/OverlappingMarkerSpiderfier-Leaflet
 * Copyright (c) 2011 - 2017 George MacKerron
 *
 * https://github.com/chancezeus/oms
 * Copyright (c) 2018 - 2021 Mark van Beek
 *
 * Forked and modified by Draxare
 * https://github.com/Draxare/ts-overlapping-marker-spiderfier-leaflet
 * Copyright (c) 2024 Alex Laisney
 *
 * Released under the MIT license: http://opensource.org/licenses/mit-license
 */
import * as L from 'leaflet';

import { LegColorOptions, ExtendedMarker, MarkerData, SpiderfierOptions, SpiderfierEventMap, SpiderfierEventHandler } from './omsleaflet-types';

class OverlappingMarkerSpiderfier {
    keepSpiderfied: boolean;
    nearbyDistance: number;
    circleSpiralSwitchover: number;
    circleFootSeparation: number;
    circleStartAngle: number;
    spiralFootSeparation: number;
    spiralLengthStart: number;
    spiralLengthFactor: number;
    legWeight: number;
    legColors: LegColorOptions;
    private map: L.Map;
    private spiderfied: boolean = false;
    private spiderfying: boolean = false;
    private unspiderfying: boolean = false;
    private markers: ExtendedMarker[] = [];
    private markerListeners: Array<{ marker: ExtendedMarker; listener: L.LeafletEventHandlerFn }> = [];
    private listeners: { [eventName in keyof SpiderfierEventMap]: Array<(...args: SpiderfierEventMap[eventName]) => void> } = {
      spiderfy: [],
      unspiderfy: [],
      click: [],
    };

    constructor(map: L.Map, opts: SpiderfierOptions = {}) {
      this.map = map;
      this.keepSpiderfied = opts.keepSpiderfied || false;
      this.nearbyDistance = opts.nearbyDistance || 20;
      this.circleSpiralSwitchover = opts.circleSpiralSwitchover || 9;
      this.circleFootSeparation = opts.circleFootSeparation || 25;
      this.circleStartAngle = opts.circleStartAngle || (2 * Math.PI) / 12;
      this.spiralFootSeparation = opts.spiralFootSeparation || 28;
      this.spiralLengthStart = opts.spiralLengthStart || 11;
      this.spiralLengthFactor = opts.spiralLengthFactor || 5;
      this.legWeight = opts.legWeight || 1.5;
      this.legColors = opts.legColors || { usual: '#222', highlighted: '#f00' };

      this.initMarkerArrays();
      ['click', 'zoomend'].forEach(eventType => {
        this.map.addEventListener(eventType, () => this.unspiderfy());
      });
    }

    async addMarker(marker: ExtendedMarker): Promise<this> {
      if (marker._oms) {
        return this;
      }
      marker._oms = true;
      const markerListener = (event: L.LeafletEvent): Promise<void> => this.spiderListener(event.target);
      marker.addEventListener('click', markerListener);
      this.markerListeners.push({ marker, listener: markerListener });
      this.markers.push(marker);
      return this;
    }

    getMarkers(): ExtendedMarker[] {
      return [...this.markers];
    }

    async removeMarker(marker: ExtendedMarker): Promise<this> {
      if (marker._omsData) {
        await this.unspiderfy();
      }

      const i = this.arrIndexOf(this.markers, marker);
      if (i < 0) {
        return this;
      }

      const markerListener = this.markerListeners.find(m => m.marker === marker);
      if (markerListener) {
        marker.removeEventListener('click', markerListener.listener);
        this.markerListeners = this.markerListeners.filter(m => m !== markerListener);
      }

      delete marker._oms;
      this.markers.splice(i, 1);
      return this;
    }

    async clearMarkers(): Promise<this> {
      await this.unspiderfy();

      await Promise.all(
        this.markerListeners.map(async ({ marker, listener }) => {
          marker.removeEventListener('click', listener);
          delete marker._oms;
        }),
      );

      this.initMarkerArrays();
      return this;
    }

    addListener<eventName extends keyof SpiderfierEventMap>(event: eventName, func: SpiderfierEventHandler<eventName>): this {
      (this.listeners[event] ||= []).push(func);
      return this;
    }

    removeListener<eventName extends keyof SpiderfierEventMap>(event: eventName, func: SpiderfierEventHandler<eventName>): this {
      const i = this.arrIndexOf(this.listeners[event], func);
      if (i >= 0) {
        this.listeners[event].splice(i, 1);
      }
      return this;
    }

    clearListeners<eventName extends keyof SpiderfierEventMap>(event: eventName): this {
      this.listeners[event] = [];
      return this;
    }

    async unspiderfy(markerNotToMove: ExtendedMarker | null = null): Promise<this> {
      if (!this.spiderfied || this.unspiderfying) {
        return this;
      }
      this.unspiderfying = true;

      try {
        const unspiderfiedMarkers: ExtendedMarker[] = [];
        const nonNearbyMarkers: ExtendedMarker[] = [];

        await Promise.all(
          this.markers.map(async (marker) => {
            if (marker._omsData) {
              await this.unspiderfyMarker(marker, markerNotToMove);
              unspiderfiedMarkers.push(marker);
            } else {
              nonNearbyMarkers.push(marker);
            }
          }),
        );

        this.spiderfied = false;
        await this.trigger('unspiderfy', unspiderfiedMarkers, nonNearbyMarkers);
        return this;
      } finally {
        this.unspiderfying = false;
      }
    }

    private async unspiderfyMarker(marker: ExtendedMarker, markerNotToMove: ExtendedMarker | null): Promise<void> {
      await new Promise<void>(resolve => {
        this.map.removeLayer(marker._omsData!.leg);
        resolve();
      });

      if (marker !== markerNotToMove) {
        marker.setLatLng(marker._omsData!.usualPosition);
      }

      marker.setZIndexOffset(0);

      const mhl = marker._omsData!.highlightListeners;
      if (mhl) {
        marker.removeEventListener('mouseover', mhl.highlight);
        marker.removeEventListener('mouseout', mhl.unhighlight);
      }

      delete marker._omsData;
    }

    private initMarkerArrays(): void {
      this.markers = [];
      this.markerListeners = [];
    }

    private async trigger<eventName extends keyof SpiderfierEventMap>(event: eventName, ...args: SpiderfierEventMap[eventName]): Promise<void> {
      await Promise.all(
        (this.listeners[event] || []).map(async (func) => {
          await (func as (...args: SpiderfierEventMap[eventName]) => void | Promise<void>)(...args);
        }),
      );
    }

    private generatePtsCircle(count: number, centerPt: L.Point): L.Point[] {
      const circumference = this.circleFootSeparation * (2 + count);
      const legLength = circumference / (2 * Math.PI);
      const angleStep = (2 * Math.PI) / count;
      return Array.from({ length: count }, (_, i) => {
        const angle = this.circleStartAngle + i * angleStep;
        return new L.Point(
          centerPt.x + legLength * Math.cos(angle),
          centerPt.y + legLength * Math.sin(angle),
        );
      });
    }

    private generatePtsSpiral(count: number, centerPt: L.Point): L.Point[] {
      let legLength = this.spiralLengthStart;
      let angle = 0;
      return Array.from({ length: count }, (_, i) => {
        angle += this.spiralFootSeparation / legLength + i * 0.0005;
        const pt = new L.Point(
          centerPt.x + legLength * Math.cos(angle),
          centerPt.y + legLength * Math.sin(angle),
        );
        legLength += (2 * Math.PI * this.spiralLengthFactor) / angle;
        return pt;
      });
    }

    private async spiderListener(marker: ExtendedMarker): Promise<void> {
      const markerSpiderfied = marker._omsData;

      if (!markerSpiderfied || !this.keepSpiderfied) {
        await this.unspiderfy();
      }

      if (markerSpiderfied) {
        await this.trigger('click', marker);
      } else {
        if (this.spiderfying) {
          return;
        }
        this.spiderfying = true;

        try {
          const { nearbyMarkerData, nonNearbyMarkers } = await this.getNearbyMarkers(marker);

          if (nearbyMarkerData.length === 1) {
            await this.trigger('click', marker);
          } else {
            await this.spiderfy(nearbyMarkerData, nonNearbyMarkers);
          }
        } finally {
          this.spiderfying = false;
        }
      }
    }

    private async getNearbyMarkers(marker: ExtendedMarker): Promise<{nearbyMarkerData: MarkerData[]; nonNearbyMarkers: ExtendedMarker[]}> {
      const nearbyMarkerData: MarkerData[] = [];
      const nonNearbyMarkers: ExtendedMarker[] = [];
      const pxSq = this.nearbyDistance * this.nearbyDistance;
      const markerPt = this.map.latLngToLayerPoint(marker.getLatLng());

      await Promise.all(
        this.markers.map(async (m) => {
          if (!this.map.hasLayer(m)) {
            return;
          }
          const mPt = this.map.latLngToLayerPoint(m.getLatLng());
          if (this.ptDistanceSq(mPt, markerPt) < pxSq) {
            nearbyMarkerData.push({ marker: m, markerPt: mPt });
          } else {
            nonNearbyMarkers.push(m);
          }
        }),
      );

      return { nearbyMarkerData, nonNearbyMarkers };
    }

    private makeHighlightListeners(marker: ExtendedMarker): { highlight: () => void; unhighlight: () => void } {
      return {
        highlight: () => marker._omsData!.leg.setStyle({ color: this.legColors.highlighted }),
        unhighlight: () => marker._omsData!.leg.setStyle({ color: this.legColors.usual }),
      };
    }

    private async spiderfy(markerData: MarkerData[], nonNearbyMarkers: ExtendedMarker[]): Promise<void> {
      this.spiderfying = true;

      try {
        const numFeet = markerData.length;
        const bodyPt = this.ptAverage(markerData.map(md => md.markerPt));
        const footPts = numFeet >= this.circleSpiralSwitchover
          ? this.generatePtsSpiral(numFeet, bodyPt).reverse()
          : this.generatePtsCircle(numFeet, bodyPt);

        const spiderfiedMarkers = await Promise.all(
          footPts.map(async (footPt) => {
            const footLl = this.map.layerPointToLatLng(footPt);
            const nearestMarkerDatum = this.minExtract(markerData, md =>
              this.ptDistanceSq(md.markerPt, footPt));
            return this.setupSpiderfiedMarker(nearestMarkerDatum.marker, footLl);
          }),
        );

        this.spiderfied = true;
        await this.trigger('spiderfy', spiderfiedMarkers, nonNearbyMarkers);
      } finally {
        this.spiderfying = false;
      }
    }

    private async setupSpiderfiedMarker(marker: ExtendedMarker, footLl: L.LatLng): Promise<ExtendedMarker> {
      const leg = new L.Polyline([marker.getLatLng(), footLl], {
        color: this.legColors.usual,
        weight: this.legWeight,
        interactive: false,
      });

      await new Promise<void>(resolve => {
        this.map.addLayer(leg);
        resolve();
      });

      marker._omsData = { usualPosition: marker.getLatLng(), leg };

      if (this.legColors.highlighted !== this.legColors.usual) {
        const mhl = this.makeHighlightListeners(marker);
        marker._omsData.highlightListeners = mhl;
        marker.addEventListener('mouseover', mhl.highlight);
        marker.addEventListener('mouseout', mhl.unhighlight);
      }

      marker.setLatLng(footLl);
      marker.setZIndexOffset(1000000);
      return marker;
    }

    private ptDistanceSq(pt1: L.Point, pt2: L.Point): number {
      const dx = pt1.x - pt2.x;
      const dy = pt1.y - pt2.y;
      return dx * dx + dy * dy;
    }

    private ptAverage(pts: L.Point[]): L.Point {
      const sumX = pts.reduce((sum, pt) => sum + pt.x, 0);
      const sumY = pts.reduce((sum, pt) => sum + pt.y, 0);
      const numPts = pts.length;
      return new L.Point(sumX / numPts, sumY / numPts);
    }

    private minExtract<T>(set: T[], func: (item: T) => number): T {
      let bestIndex = 0;
      let bestVal = func(set[0]);
      set.forEach((item, index) => {
        const val = func(item);
        if (val < bestVal) {
          bestVal = val;
          bestIndex = index;
        }
      });
      return set.splice(bestIndex, 1)[0];
    }

    private arrIndexOf<T>(arr: T[], obj: T): number {
      return arr.indexOf(obj);
    }
}

export { OverlappingMarkerSpiderfier, SpiderfierOptions };
