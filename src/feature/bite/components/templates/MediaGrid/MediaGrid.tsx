import React, { useState, useCallback } from "react";
import { DropZone, Image, Icon, Button } from "@shopify/polaris";
import styles from "./MediaGrid.module.css";

/**
 * MediaGrid Component
 *
 * IMPORTANT: This component requires @shopify/polaris package.
 * Install with: npm install @shopify/polaris
 *
 * Example usage:
 * ```tsx
 * import { MediaGrid } from "@/feature/bite/components/templates/MediaGrid/MediaGrid";
 *
 * const [images, setImages] = useState([]);
 *
 * <MediaGrid images={images} setImages={setImages} />
 * ```
 */

export interface MediaItem {
  id: string;
  url: string;
  alt?: string;
}

export interface MediaGridProps {
  images: MediaItem[];
  setImages: (images: MediaItem[] | ((prev: MediaItem[]) => MediaItem[])) => void;
}

export const MediaGrid: React.FC<MediaGridProps> = ({ images, setImages }) => {
  const [hoveredImageId, setHoveredImageId] = useState<string | null>(null);

  const handleDropZoneDrop = useCallback(
    (_dropFiles: File[], acceptedFiles: File[], _rejectedFiles: File[]) => {
      const newImages = acceptedFiles.map((file, index) => ({
        id: `${Date.now()}-${index}`,
        url: URL.createObjectURL(file),
        alt: file.name,
      }));
      setImages((prev) => [...prev, ...newImages]);
    },
    [setImages]
  );

  const handleDelete = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const validImageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  return (
    <div className={styles.mediaGrid}>
      <DropZone
        accept={validImageTypes.join(",")}
        type="image"
        onDrop={handleDropZoneDrop}
      >
        <DropZone.FileUpload />
      </DropZone>

      <div className={styles.grid}>
        {images.map((image, index) => (
          <div
            key={image.id}
            className={`${styles.gridItem} ${index === 0 ? styles.gridItemLarge : ""}`}
            onMouseEnter={() => setHoveredImageId(image.id)}
            onMouseLeave={() => setHoveredImageId(null)}
          >
            <Image
              source={image.url}
              alt={image.alt || `Image ${index + 1}`}
              width="100%"
              height="100%"
            />
            {hoveredImageId === image.id && (
              <div className={styles.overlay}>
                <Button
                  variant="plain"
                  onClick={() => handleDelete(image.id)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
