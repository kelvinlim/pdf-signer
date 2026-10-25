//! Burn signature images into a PDF's page content.
//!
//! Bytes in, bytes out: [`stamp_pdf`] takes the original file and returns the
//! stamped file, so a later phase can append a cryptographic signing step.
//! The whole file is rewritten (not an incremental update), which would
//! invalidate any existing digital signature; that is acceptable for phase 1.

use image::ImageFormat;
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};
use serde::Deserialize;

/// One signature image to place on one page.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stamp {
    /// 1-based page number.
    pub page: u32,
    /// Placement box in PDF user space (points, origin bottom-left).
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Page `/Rotate` (0, 90, 180, 270), so the image reads upright when displayed.
    pub rotation: u32,
    /// PNG or JPEG file bytes.
    pub image: Vec<u8>,
}

/// Matrix `[a b c d e f]` mapping the unit square (the image) onto the
/// placement box so the image is upright on a page displayed with `rotation`.
pub fn image_matrix(x: f64, y: f64, w: f64, h: f64, rotation: u32) -> Result<[f64; 6], String> {
    match rotation % 360 {
        0 => Ok([w, 0.0, 0.0, h, x, y]),
        90 => Ok([0.0, h, -w, 0.0, x + w, y]),
        180 => Ok([-w, 0.0, 0.0, -h, x + w, y + h]),
        270 => Ok([0.0, -h, w, 0.0, x, y + h]),
        r => Err(format!("Unsupported page rotation: {r}")),
    }
}

struct DecodedImage {
    width: u32,
    height: u32,
    rgb: Vec<u8>,
    /// Present only when some pixel is not fully opaque.
    alpha: Option<Vec<u8>>,
}

fn decode_image(bytes: &[u8]) -> Result<DecodedImage, String> {
    let format = match image::guess_format(bytes) {
        Ok(f @ (ImageFormat::Png | ImageFormat::Jpeg)) => f,
        _ => return Err("Signature must be a PNG or JPEG image.".into()),
    };
    let rgba = image::load_from_memory_with_format(bytes, format)
        .map_err(|e| format!("Could not decode the signature image: {e}"))?
        .to_rgba8();
    let (width, height) = rgba.dimensions();

    let mut rgb = Vec::with_capacity((width * height * 3) as usize);
    let mut alpha = Vec::with_capacity((width * height) as usize);
    for px in rgba.pixels() {
        rgb.extend_from_slice(&px.0[..3]);
        alpha.push(px.0[3]);
    }
    let translucent = alpha.iter().any(|&a| a != 255);
    Ok(DecodedImage { width, height, rgb, alpha: translucent.then_some(alpha) })
}

fn add_image_xobject(doc: &mut Document, img: &DecodedImage) -> Result<ObjectId, String> {
    let mut dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Image",
        "Width" => img.width as i64,
        "Height" => img.height as i64,
        "ColorSpace" => "DeviceRGB",
        "BitsPerComponent" => 8,
    };
    if let Some(alpha) = &img.alpha {
        let mut mask = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => img.width as i64,
                "Height" => img.height as i64,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8,
            },
            alpha.clone(),
        );
        mask.compress().map_err(|e| e.to_string())?;
        dict.set("SMask", Object::Reference(doc.add_object(mask)));
    }
    let mut stream = Stream::new(dict, img.rgb.clone());
    stream.compress().map_err(|e| e.to_string())?;
    Ok(doc.add_object(stream))
}

/// Clone a dictionary-valued entry that is either direct or an indirect reference.
fn clone_dict(doc: &Document, obj: &Object) -> Option<Dictionary> {
    match obj {
        Object::Dictionary(d) => Some(d.clone()),
        Object::Reference(id) => doc.get_dictionary(*id).ok().cloned(),
        _ => None,
    }
}

/// The page's effective resources, following `/Parent` for inherited ones.
fn effective_resources(doc: &Document, page_id: ObjectId) -> Dictionary {
    let mut current = Some(page_id);
    // Bounded walk so a malformed (cyclic) page tree cannot hang us.
    for _ in 0..64 {
        let Some(id) = current else { break };
        let Ok(dict) = doc.get_dictionary(id) else { break };
        if let Some(res) = dict.get(b"Resources").ok().and_then(|o| clone_dict(doc, o)) {
            return res;
        }
        current = dict.get(b"Parent").ok().and_then(|o| o.as_reference().ok());
    }
    Dictionary::new()
}

/// The page's existing content streams as a flat list of references.
fn existing_contents(doc: &Document, page_id: ObjectId) -> Vec<Object> {
    let Some(contents) = doc.get_dictionary(page_id).ok().and_then(|d| d.get(b"Contents").ok()) else {
        return vec![];
    };
    match contents {
        Object::Array(items) => items.clone(),
        Object::Reference(id) => match doc.get_object(*id) {
            Ok(Object::Array(items)) => items.clone(),
            _ => vec![Object::Reference(*id)],
        },
        _ => vec![],
    }
}

pub fn stamp_pdf(pdf: &[u8], stamps: &[Stamp]) -> Result<Vec<u8>, String> {
    let mut doc = Document::load_mem(pdf).map_err(|e| format!("Could not read the PDF: {e}"))?;
    if doc.is_encrypted() {
        return Err("This PDF is password-protected. Encrypted PDFs are not supported yet.".into());
    }
    let pages = doc.get_pages();

    // Group by page, preserving the order the stamps were given.
    let mut page_numbers: Vec<u32> = stamps.iter().map(|s| s.page).collect();
    page_numbers.sort_unstable();
    page_numbers.dedup();

    let mut counter = 0usize;
    for page_no in page_numbers {
        let page_id = *pages
            .get(&page_no)
            .ok_or_else(|| format!("The PDF has no page {page_no}."))?;

        let mut resources = effective_resources(&doc, page_id);
        let mut xobjects = resources
            .get(b"XObject")
            .ok()
            .and_then(|o| clone_dict(&doc, o))
            .unwrap_or_default();
        let mut ops = String::new();

        for stamp in stamps.iter().filter(|s| s.page == page_no) {
            if !(stamp.width > 0.0 && stamp.height > 0.0) {
                return Err("The signature has no size.".into());
            }
            let m = image_matrix(stamp.x, stamp.y, stamp.width, stamp.height, stamp.rotation)?;
            let image_id = add_image_xobject(&mut doc, &decode_image(&stamp.image)?)?;
            counter += 1;
            let name = format!("PdfSignerIm{counter}");
            xobjects.set(name.as_bytes().to_vec(), Object::Reference(image_id));
            ops.push_str(&format!(
                "q {:.4} {:.4} {:.4} {:.4} {:.4} {:.4} cm /{name} Do Q\n",
                m[0], m[1], m[2], m[3], m[4], m[5]
            ));
        }
        resources.set("XObject", Object::Dictionary(xobjects));

        // Wrap the original content in q/Q so any graphics state it leaves
        // behind (e.g. a changed CTM) cannot displace the stamp.
        let save = doc.add_object(Stream::new(Dictionary::new(), b"q\n".to_vec()));
        let restore = doc.add_object(Stream::new(Dictionary::new(), b"Q\n".to_vec()));
        let stamp_stream = doc.add_object(Stream::new(Dictionary::new(), ops.into_bytes()));
        let mut contents = vec![Object::Reference(save)];
        contents.extend(existing_contents(&doc, page_id));
        contents.push(Object::Reference(restore));
        contents.push(Object::Reference(stamp_stream));

        let page = doc
            .get_object_mut(page_id)
            .and_then(Object::as_dict_mut)
            .map_err(|e| e.to_string())?;
        page.set("Resources", Object::Dictionary(resources));
        page.set("Contents", Object::Array(contents));
    }

    let mut out = Vec::new();
    doc.save_to(&mut out).map_err(|e| format!("Could not write the PDF: {e}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests;
